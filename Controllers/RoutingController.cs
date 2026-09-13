using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using ProMapCargo.Api.Models;
using ProMapCargo.Api.Routing;
using ProMapCargo.Api.Services;

namespace ProMapCargo.Api.Controllers;

[ApiController]
[Route("api/routing")]
public sealed class RoutingController( IPostGisRoutingService postGis, IRoutingService legacy, IRestrictionEngine restrictions, ILogger<RoutingController> logger) : ControllerBase
{
    [HttpPost("route")]
    public async Task<ActionResult<RouteResponse>> Route([FromBody] RouteRequest request, CancellationToken ct)
    {
        if (!IsValidPoint(request.Start))
        {
            return BadRequest(new
            {
                code = "InvalidStart",
                message = "Start mora sadržati validne geografske koordinate."
            });
        }

        if (!IsValidPoint(request.Target))
        {
            return BadRequest(new
            {
                code = "InvalidDestination",
                message = "Destination mora sadržati validne geografske koordinate."
            });
        }

        var profile = string.IsNullOrWhiteSpace(request.Profile)
            ? "truck"
            : request.Profile.Trim().ToLowerInvariant();

        var normalizedRequest = new RouteRequest
        {
            Start = request.Start,
            Destination = request.Target,
            Profile = profile,
            AvoidRestricted = request.AvoidRestricted,
            Truck = request.Truck,
            DepartureAt = request.DepartureAt
        };

        logger.LogInformation("Routing request: {Profile} {StartLat},{StartLon} -> {EndLat},{EndLon}",
            profile,
            normalizedRequest.Start.Lat,
            normalizedRequest.Start.Lon,
            normalizedRequest.Target.Lat,
            normalizedRequest.Target.Lon
        );

        /*
         * ============================================================
         * 1. PRIMARY ENGINE: PostGIS / OSM graph
         * ============================================================
         */

        if (profile.Equals("truck", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                var postGisResult = await postGis.CalculateAsync(
                    normalizedRequest,
                    ct
                );

                if (postGisResult.Code.Equals(
                        "Ok",
                        StringComparison.OrdinalIgnoreCase)
                    && postGisResult.Routes.Count > 0)
                {
                    logger.LogInformation(
                        "PostGIS routing succeeded. Distance={Distance}m Duration={Duration}s",
                        postGisResult.Routes[0].Distance,
                        postGisResult.Routes[0].Duration
                    );

                    return Ok(postGisResult);
                }

                logger.LogWarning(
                    "PostGIS routing did not produce a route. Code={Code}. Falling back to OSRM.",
                    postGisResult.Code
                );
            }
            catch (Exception ex)
            {
                logger.LogWarning(
                    ex,
                    "PostGIS routing failed. Falling back to OSRM."
                );
            }
        }

        /*
         * ============================================================
         * 2. FALLBACK ENGINE: OSRM
         * ============================================================
         */

        OsrmResponse osrm;

        try
        {
            osrm = await legacy.RouteAsync(
                normalizedRequest,
                ct
            );
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger.LogError(
                ex,
                "OSRM routing failed."
            );

            return StatusCode(
                StatusCodes.Status503ServiceUnavailable,
                new
                {
                    code = "RoutingUnavailable",
                    message = "Routing servis trenutno nije dostupan.",
                    details = ex.Message
                }
            );
        }

        if (osrm is null)
        {
            return StatusCode(
                StatusCodes.Status503ServiceUnavailable,
                new
                {
                    code = "RoutingUnavailable",
                    message = "Routing servis nije vratio odgovor."
                }
            );
        }

        if (!string.Equals(
                osrm.Code,
                "Ok",
                StringComparison.OrdinalIgnoreCase))
        {
            return StatusCode(
                StatusCodes.Status502BadGateway,
                new
                {
                    code = "OsrmError",
                    message = "OSRM nije uspešno izračunao rutu.",
                    osrmCode = osrm.Code
                }
            );
        }

        if (osrm.Routes is null || osrm.Routes.Count == 0)
        {
            return StatusCode(
                StatusCodes.Status502BadGateway,
                new
                {
                    code = "NoRoute",
                    message = "OSRM nije pronašao rutu."
                }
            );
        }

        /*
         * ============================================================
         * 3. Convert OsrmResponse -> RouteResponse
         * ============================================================
         */

        var routeCandidates = new List<RouteCandidate>();

        foreach (var route in osrm.Routes)
        {
            var points = ExtractPoints(route.Geometry);

            IReadOnlyList<RestrictionViolation> violations;

            if (profile.Equals(
                    "truck",
                    StringComparison.OrdinalIgnoreCase))
            {
                violations = await restrictions.Analyze(
                    points,
                    normalizedRequest.Truck,
                    normalizedRequest.DepartureAt
                );
            }
            else
            {
                violations = Array.Empty<RestrictionViolation>();
            }

            var violationList = violations.ToList();

            var restricted = violationList.Count > 0;

            /*
             * Veći score = bolja ruta.
             * Rute sa restrikcijama dobijaju penal.
             */
            var score = restricted
                ? Math.Max(
                    0,
                    100 - violationList.Count * 20
                )
                : 100;

            routeCandidates.Add(
                new RouteCandidate
                {
                    Distance = route.Distance,
                    Duration = route.Duration,
                    Geometry = route.Geometry,
                    Legs = route.Legs,

                    Analysis = new RouteAnalysis
                    {
                        Restricted = restricted,
                        Score = score,
                        Violations = violationList
                    }
                }
            );
        }

        /*
         * ============================================================
         * 4. Izbor najbolje OSRM rute
         * ============================================================
         */

        var selectedRouteIndex = 0;

        if (routeCandidates.Count > 1)
        {
            var truckCandidates = routeCandidates
                .Select(
                    (route, index) => new
                    {
                        Route = route,
                        Index = index
                    }
                )
                .OrderByDescending(x => x.Route.Analysis.Score)
                .ThenBy(x => x.Route.Distance)
                .ToList();

            selectedRouteIndex = truckCandidates[0].Index;
        }

        var selectedRoute =
            routeCandidates[selectedRouteIndex];

        var selectedViolations =
            selectedRoute.Analysis.Violations;

        var isTruckSafe =
            !profile.Equals(
                "truck",
                StringComparison.OrdinalIgnoreCase
            )
            || selectedViolations.Count == 0;

        /*
         * ============================================================
         * 5. Geometry / maneuvers
         * ============================================================
         *
         * Trenutni OsrmResponse model nema Maneuvers property.
         * Zato ovde ne pokušavamo da čitamo nepostojeće polje.
         *
         * Navigation UI može koristiti geometry + legs,
         * a maneuvers možemo dodati u sledećem koraku.
         */

        var summary = new RouteSummary(
            selectedRoute.Distance,
            selectedRoute.Duration,
            (
                normalizedRequest.DepartureAt
                ?? DateTimeOffset.UtcNow
            ).AddSeconds(selectedRoute.Duration)
        );

        var response = new RouteResponse
        {
            Code = "Ok",

            Routes = routeCandidates,

            SelectedRouteIndex =
                selectedRouteIndex,

            IsTruckSafe =
                isTruckSafe,

            Violations =
                selectedViolations,

            Summary =
                summary,

            Diagnostics =
                new RouteDiagnostics
                {
                    Engine = "OSRM",
                    UsedFallback = true,
                    ExpandedStates = 0,
                    GraphVersion = null,
                    FailureReason = null
                },

            Maneuvers = []
        };

        logger.LogInformation(
            "OSRM fallback succeeded. Routes={Routes}, Selected={Selected}, Distance={Distance}m, Duration={Duration}s, TruckSafe={TruckSafe}",
            routeCandidates.Count,
            selectedRouteIndex,
            selectedRoute.Distance,
            selectedRoute.Duration,
            isTruckSafe
        );

        return Ok(response);
    }

    /*
     * ================================================================
     * Geometry extraction
     * ================================================================
     */

    private static List<GeoPoint> ExtractPoints(
        object? geometry)
    {
        if (geometry is null)
        {
            return [];
        }

        try
        {
            if (geometry is JsonElement element)
            {
                return ExtractPointsFromJson(element);
            }

            var json = JsonSerializer.Serialize(
                geometry
            );

            using var document =
                JsonDocument.Parse(json);

            return ExtractPointsFromJson(
                document.RootElement
            );
        }
        catch
        {
            return [];
        }
    }

    private static List<GeoPoint> ExtractPointsFromJson(
        JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return [];
        }

        /*
         * GeoJSON Feature
         */

        if (
            root.TryGetProperty(
                "type",
                out var typeProperty
            )
            && typeProperty.ValueKind ==
               JsonValueKind.String
            && string.Equals(
                typeProperty.GetString(),
                "Feature",
                StringComparison.OrdinalIgnoreCase
            )
        )
        {
            if (
                root.TryGetProperty(
                    "geometry",
                    out var featureGeometry
                )
            )
            {
                return ExtractPointsFromJson(
                    featureGeometry
                );
            }
        }

        /*
         * GeoJSON Geometry
         */

        if (
            root.TryGetProperty(
                "coordinates",
                out var coordinates
            )
        )
        {
            if (
                root.TryGetProperty(
                    "type",
                    out var geometryType
                )
                && geometryType.ValueKind ==
                   JsonValueKind.String
            )
            {
                var type =
                    geometryType.GetString();

                if (string.Equals(
                        type,
                        "LineString",
                        StringComparison.OrdinalIgnoreCase))
                {
                    return ParseLineString(
                        coordinates
                    );
                }

                if (string.Equals(
                        type,
                        "MultiLineString",
                        StringComparison.OrdinalIgnoreCase))
                {
                    var result =
                        new List<GeoPoint>();

                    foreach (
                        var line in coordinates.EnumerateArray()
                    )
                    {
                        result.AddRange(
                            ParseLineString(line)
                        );
                    }

                    return result;
                }
            }

            /*
             * Ako nema type, pokušaj direktno
             * da protumačiš coordinates kao LineString.
             */

            return ParseLineString(
                coordinates
            );
        }

        return [];
    }

    private static List<GeoPoint> ParseLineString(
        JsonElement coordinates)
    {
        var result =
            new List<GeoPoint>();

        if (coordinates.ValueKind !=
            JsonValueKind.Array)
        {
            return result;
        }

        foreach (
            var coordinate in
            coordinates.EnumerateArray()
        )
        {
            if (
                coordinate.ValueKind !=
                JsonValueKind.Array
                || coordinate.GetArrayLength() < 2
            )
            {
                continue;
            }

            var lon =
                coordinate[0].GetDouble();

            var lat =
                coordinate[1].GetDouble();

            if (
                !double.IsFinite(lat)
                || !double.IsFinite(lon)
            )
            {
                continue;
            }

            result.Add(
                new GeoPoint(
                    lat,
                    lon
                )
            );
        }

        return result;
    }

    /*
     * ================================================================
     * Coordinate validation
     * ================================================================
     */

    private static bool IsValidPoint(
        GeoPoint? point)
    {
        if (point is null)
        {
            return false;
        }

        if (
            !double.IsFinite(point.Lat)
            || !double.IsFinite(point.Lon)
        )
        {
            return false;
        }

        return point.Lat >= -90
            && point.Lat <= 90
            && point.Lon >= -180
            && point.Lon <= 180;
    }
}