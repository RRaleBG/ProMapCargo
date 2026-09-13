using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ProMapCargo.Api.Models;
using ProMapCargo.Api.Routing;
using ProMapCargo.Api.Services;

namespace ProMapCargo.Api.Controllers;

[ApiController]
[Route("api/route")]
public sealed class RoutingController(
    IPostGisRoutingService postgis,
    IRoutingService osrm,
    IRestrictionEngine restrictions,
    ILogger<RoutingController> logger)
    : ControllerBase
{
    [HttpPost]
    [AllowAnonymous]
    public async Task<ActionResult<RouteResponse>> Calculate(
        [FromBody] RouteRequest request,
        CancellationToken ct)
    {
        try
        {
            Validate(request);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new
            {
                code = "InvalidRequest",
                message = ex.Message
            });
        }

        /*
         * 1. PRVO pokušavamo pravi PostGIS/OSM truck routing.
         */
        try
        {
            var postgisResult =
                await postgis.CalculateAsync(request, ct);

            if (postgisResult.Code.Equals(
                    "Ok",
                    StringComparison.OrdinalIgnoreCase) &&
                postgisResult.Routes.Count > 0)
            {
                return Ok(postgisResult);
            }

            logger.LogInformation(
                "PostGIS routing nije vratio rutu. Code={Code}",
                postgisResult.Code);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger.LogWarning(
                ex,
                "PostGIS routing nije dostupan. Prelazim na OSRM fallback.");
        }

        /*
         * 2. Ako PostGIS graph nije dostupan,
         *    koristimo OSRM fallback.
         */
        OsrmResponse osrmResponse;

        try
        {
            osrmResponse =
                await osrm.RouteAsync(request, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger.LogError(
                ex,
                "OSRM routing takođe nije dostupan.");

            return StatusCode(
                StatusCodes.Status503ServiceUnavailable,
                new
                {
                    code = "RoutingUnavailable",
                    message = "Routing servis trenutno nije dostupan."
                });
        }

        if (!osrmResponse.Code.Equals(
                "Ok",
                StringComparison.OrdinalIgnoreCase) ||
            osrmResponse.Routes.Count == 0)
        {
            return BadRequest(new
            {
                code = osrmResponse.Code,
                message = "Ruta nije pronađena."
            });
        }

        /*
         * 3. OSRM route -> naš RouteCandidate model.
         */
        var candidates =
            new List<RouteCandidate>();

        foreach (var osrmRoute in osrmResponse.Routes)
        {
            var points =
                ExtractPoints(osrmRoute.Geometry);

            IReadOnlyList<RestrictionViolation> violations;

            if (request.Profile.Equals(
                    "truck",
                    StringComparison.OrdinalIgnoreCase))
            {
                violations =
                    await restrictions.AnalyzeAsync(
                        points,
                        request.Truck,
                        request.DepartureAt,
                        ct);
            }
            else
            {
                violations = [];
            }

            var analysis =
                new RouteAnalysis
                {
                    Restricted = violations.Count > 0,
                    Score = violations.Count,
                    Violations = violations.ToList()
                };

            candidates.Add(
                new RouteCandidate
                {
                    Distance = osrmRoute.Distance,
                    Duration = osrmRoute.Duration,
                    Geometry = osrmRoute.Geometry,
                    Legs = osrmRoute.Legs,
                    Analysis = analysis
                });
        }

        if (candidates.Count == 0)
        {
            return BadRequest(new
            {
                code = "NoRoute",
                message = "Ruta nije pronađena."
            });
        }

        /*
         * 4. Izbor najbolje alternative.
         *
         * Ako korisnik traži izbegavanje restrikcija:
         *   prvo biramo rutu bez restrikcija,
         *   zatim najkraće vreme.
         *
         * Ako nema takve rute:
         *   biramo najkraće vreme.
         */
        var selectedIndex =
            Enumerable
                .Range(0, candidates.Count)
                .OrderBy(index =>
                    request.AvoidRestricted &&
                    candidates[index].Analysis.Restricted)
                .ThenBy(index =>
                    candidates[index].Duration)
                .First();

        var selected =
            candidates[selectedIndex];

        /*
         * 5. Skupljamo sve jedinstvene violation-e.
         */
        var allViolations =
            candidates
                .SelectMany(x => x.Analysis.Violations)
                .GroupBy(x => x.Id)
                .Select(x => x.First())
                .ToList();

        /*
         * 6. Kreiramo standardni RouteResponse.
         */
        var estimatedArrival =
            (request.DepartureAt ?? DateTimeOffset.UtcNow)
            .AddSeconds(selected.Duration);

        var response =
            new RouteResponse
            {
                Code = "Ok",

                Routes = candidates,

                SelectedRouteIndex = selectedIndex,

                IsTruckSafe =
                    !selected.Analysis.Restricted,

                Violations = allViolations,

                Summary =
                    new RouteSummary(
                        selected.Distance,
                        selected.Duration,
                        estimatedArrival),

                Diagnostics =
                    new RouteDiagnostics
                    {
                        Engine = "OSRM",
                        UsedFallback = true,
                        ExpandedStates = 0,
                        GraphVersion = null,
                        FailureReason =
                            "PostGIS graph nije korišćen; ruta je dobijena preko OSRM fallback-a."
                    },

                Maneuvers = ExtractManeuvers(selected.Legs)
            };

        return Ok(response);
    }

    private static void Validate(RouteRequest request)
    {
        if (request is null)
        {
            throw new ArgumentException(
                "Route request nije prosleđen.");
        }

        ValidatePoint(
            request.Start,
            "Start");

        ValidatePoint(
            request.Target,
            "Destination");

        if (request.Truck is null)
        {
            return;
        }

        if (request.Truck.GrossWeightTons <= 0)
        {
            throw new ArgumentException(
                "Masa kamiona mora biti veća od 0.");
        }

        if (request.Truck.HeightMeters <= 0)
        {
            throw new ArgumentException(
                "Visina kamiona mora biti veća od 0.");
        }

        if (request.Truck.WidthMeters <= 0)
        {
            throw new ArgumentException(
                "Širina kamiona mora biti veća od 0.");
        }

        if (request.Truck.LengthMeters <= 0)
        {
            throw new ArgumentException(
                "Dužina kamiona mora biti veća od 0.");
        }

        if (request.Truck.AxleLoadTons is not null &&
            request.Truck.AxleLoadTons <= 0)
        {
            throw new ArgumentException(
                "Osovinsko opterećenje mora biti veće od 0.");
        }
    }

    private static void ValidatePoint(
        GeoPoint point,
        string name)
    {
        if (point is null)
        {
            throw new ArgumentException(
                $"{name} nije definisan.");
        }

        if (double.IsNaN(point.Lat) ||
            double.IsInfinity(point.Lat) ||
            point.Lat < -90 ||
            point.Lat > 90)
        {
            throw new ArgumentException(
                $"{name} ima neispravnu geografsku širinu.");
        }

        if (double.IsNaN(point.Lon) ||
            double.IsInfinity(point.Lon) ||
            point.Lon < -180 ||
            point.Lon > 180)
        {
            throw new ArgumentException(
                $"{name} ima neispravnu geografsku dužinu.");
        }
    }

    private static List<GeoPoint> ExtractPoints(
        object? geometry)
    {
        if (geometry is null)
        {
            return [];
        }

        try
        {
            using var document =
                JsonDocument.Parse(
                    JsonSerializer.Serialize(geometry));

            var root =
                document.RootElement;

            /*
             * Podržavamo:
             *
             * {
             *   "type": "LineString",
             *   "coordinates": [...]
             * }
             *
             * i Feature:
             *
             * {
             *   "type": "Feature",
             *   "geometry": {...}
             * }
             */

            if (root.ValueKind != JsonValueKind.Object)
            {
                return [];
            }

            if (root.TryGetProperty(
                    "geometry",
                    out var featureGeometry) &&
                featureGeometry.ValueKind ==
                    JsonValueKind.Object)
            {
                root = featureGeometry;
            }

            if (!root.TryGetProperty(
                    "coordinates",
                    out var coordinates))
            {
                return [];
            }

            if (coordinates.ValueKind !=
                JsonValueKind.Array)
            {
                return [];
            }

            /*
             * LineString:
             *
             * [
             *   [longitude, latitude],
             *   [longitude, latitude]
             * ]
             */
            if (coordinates.GetArrayLength() == 0)
            {
                return [];
            }

            var first =
                coordinates[0];

            if (first.ValueKind !=
                JsonValueKind.Array ||
                first.GetArrayLength() < 2)
            {
                return [];
            }

            var result =
                new List<GeoPoint>();

            foreach (var coordinate in coordinates.EnumerateArray())
            {
                if (coordinate.ValueKind !=
                    JsonValueKind.Array ||
                    coordinate.GetArrayLength() < 2)
                {
                    continue;
                }

                var lon =
                    coordinate[0].GetDouble();

                var lat =
                    coordinate[1].GetDouble();

                if (double.IsNaN(lat) ||
                    double.IsNaN(lon) ||
                    double.IsInfinity(lat) ||
                    double.IsInfinity(lon))
                {
                    continue;
                }

                if (lat < -90 ||
                    lat > 90 ||
                    lon < -180 ||
                    lon > 180)
                {
                    continue;
                }

                result.Add(
                    new GeoPoint(
                        lat,
                        lon));
            }

            return result;
        }
        catch
        {
            return [];
        }
    }

    private static List<RouteManeuverDto> ExtractManeuvers(
        object? legs)
    {
        /*
         * OSRM legs mogu imati različite JSON strukture.
         * Za sada ne izmišljamo maneuver podatke.
         *
         * Navigation frontend može koristiti geometry
         * čak i kada OSRM nema parsirane maneuvre.
         */
        return [];
    }
}