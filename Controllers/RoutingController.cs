using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ProMapCargo.Api.Models;
using ProMapCargo.Api.Routing;
using ProMapCargo.Api.Services;

namespace ProMapCargo.Api.Controllers;

[ApiController]
[Route("api/route")]
public sealed class RoutingController(IPostGisRoutingService postgis, IRoutingService legacy, IRestrictionEngine restrictions, ILogger<RoutingController> logger) : ControllerBase
{
    [HttpPost]
    [AllowAnonymous]
    public async Task<ActionResult<RouteResponse>> Calculate([FromBody] RouteRequest request, CancellationToken ct)
    {
        var validationError = Validate(request);
        if (validationError is not null)
        {
            return BadRequest(new
            {
                code = "InvalidRequest",
                message = validationError
            });
        }
        try
        {
            var postGisResult = await postgis.CalculateAsync(request, ct);
            if (postGisResult.Code == "Ok" && postGisResult.Routes.Count > 0)
            {
                return Ok(postGisResult);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "PostGIS routing unavailable; using compatibility routing engine.");
        }
        try
        {
            var osrm = await legacy.RouteAsync(request, ct);
            if (!string.Equals(osrm.Code, "Ok", StringComparison.OrdinalIgnoreCase)
                || osrm.Routes.Count == 0)
            {
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new
                {
                    code = osrm.Code,
                    message = "Ruta nije pronađena. PostGIS graf ili OSRM servis nisu dostupni."
                });
            }

            var candidates = new List<RouteCandidate>();
            foreach (var route in osrm.Routes)
            {
                var points = ExtractPoints(route.Geometry);
                IReadOnlyList<RestrictionViolation> violations = [];
                if (request.Profile.Equals("truck", StringComparison.OrdinalIgnoreCase))
                {
                    violations = await restrictions.Analyze(points, request.Truck, request.DepartureAt);
                }

                candidates.Add(new RouteCandidate
                {
                    Distance = route.Distance,
                    Duration = route.Duration,
                    Geometry = route.Geometry,
                    Legs = route.Legs,
                    Analysis = new RouteAnalysis
                    {
                        Restricted = violations.Count > 0,
                        Score = violations.Count,
                        Violations = violations.ToList()
                    }
                });
            }

            var selected = Enumerable.Range(0, candidates.Count)
                .OrderBy(i => request.AvoidRestricted && candidates[i].Analysis.Restricted)
                .ThenBy(i => candidates[i].Duration)
                .First();

            return Ok(new RouteResponse
            {
                Code = "Ok",
                Routes = candidates,
                SelectedRouteIndex = selected,
                IsTruckSafe = !candidates[selected].Analysis.Restricted,
                Violations = candidates
                    .SelectMany(x => x.Analysis.Violations)
                    .DistinctBy(x => x.Id)
                    .ToList(),
                Diagnostics = new RouteDiagnostics
                {
                    Engine = "OSRM",
                    UsedFallback = true
                }
            });
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Both routing engines failed.");
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new
            {
                code = "RoutingUnavailable",
                message = "Routing servis trenutno nije dostupan."
            });
        }
    }

    private static string? Validate(RouteRequest request)
    {
        if (!request.HasDestination)
        {
            return "Destination je obavezan.";
        }
        if (!IsValidPoint(request.Start) || !IsValidPoint(request.Target))
        {
            return "Start i destination moraju sadržati validne geografske koordinate.";
        }
        if (request.Truck is null)
        {
            return null;
        }
        if (request.Truck.GrossWeightTons <= 0
            || request.Truck.HeightMeters <= 0
            || request.Truck.WidthMeters <= 0
            || request.Truck.LengthMeters <= 0
            || request.Truck.MaxSpeedKmh <= 0)
        {
            return "Dimenzije, masa i maksimalna brzina kamiona moraju biti pozitivne vrednosti.";
        }
        return null;
    }

    private static bool IsValidPoint(GeoPoint point) =>
        !(point.Lat == 0 && point.Lon == 0)
        && point.Lat is >= -90 and <= 90
        && point.Lon is >= -180 and <= 180;

    private static List<GeoPoint> ExtractPoints(object? geometry)
    {
        if (geometry is null)
        {
            return [];
        }
        try
        {
            using var document = System.Text.Json.JsonDocument.Parse(
                System.Text.Json.JsonSerializer.Serialize(geometry));
            var coordinates = document.RootElement.GetProperty("coordinates");
            return coordinates
                .EnumerateArray()
                .Where(x => x.GetArrayLength() >= 2)
                .Select(x => new GeoPoint(x[1].GetDouble(), x[0].GetDouble()))
                .ToList();
        }
        catch (Exception)
        {
            return [];
        }
    }
}