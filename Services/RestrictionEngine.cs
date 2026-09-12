using ProMapCargo.Api.Models;

namespace ProMapCargo.Api.Services;

public sealed class RestrictionEngine(IRestrictionRepository repository) : IRestrictionEngine
{
    public Task<IReadOnlyList<RestrictionViolation>> Analyze(IEnumerable<GeoPoint> routePoints, TruckProfile? truck, DateTimeOffset? departureAt)
    {
        if (truck is null) return Task.FromResult<IReadOnlyList<RestrictionViolation>>([]);
        var points = routePoints.ToList();
        var result = new List<RestrictionViolation>();
        foreach (var r in repository.GetAll())
        {
            if (!VehicleExceedsLimit(r, truck)) continue;
            if (!TimeApplies(r, departureAt)) continue;
            if (!RouteHits(r, points)) continue;
            result.Add(new RestrictionViolation
            {
                Id = r.Id,
                Name = r.Name,
                Type = r.Type,
                Reason = BuildReason(r, truck)
            });
        }
        return Task.FromResult<IReadOnlyList<RestrictionViolation>>(result);
    }

    private static bool VehicleExceedsLimit(Restriction r, TruckProfile t)
    {
        if (r.HgvBan && t.IsHgv) return true;
        if (r.HazmatBan && !string.IsNullOrWhiteSpace(t.AdrClass)) return true;
        if (r.MaxWeightTons is not null && t.GrossWeightTons > r.MaxWeightTons) return true;
        if (r.MaxHeightMeters is not null && t.HeightMeters > r.MaxHeightMeters) return true;
        if (r.MaxWidthMeters is not null && t.WidthMeters > r.MaxWidthMeters) return true;
        if (r.MaxLengthMeters is not null && t.LengthMeters > r.MaxLengthMeters) return true;
        if (r.MaxAxleLoadTons is not null && t.AxleLoadTons is not null && t.AxleLoadTons > r.MaxAxleLoadTons) return true;
        return false;
    }

    private static bool TimeApplies(Restriction r, DateTimeOffset? departureAt)
    {
        if (departureAt is null || string.IsNullOrWhiteSpace(r.From) || string.IsNullOrWhiteSpace(r.To))
            return true;
        if (!TimeSpan.TryParse(r.From, out var from) || !TimeSpan.TryParse(r.To, out var to))
            return true;
        var t = departureAt.Value.TimeOfDay;
        return from <= to ? t >= from && t <= to : t >= from || t <= to;
    }

    private static bool RouteHits(Restriction r, List<GeoPoint> points)
    {
        foreach (var p in points)
        {
            if (HaversineMeters(p.Lat, p.Lon, r.Center[0], r.Center[1]) <= r.RadiusMeters)
                return true;
            if (r.Polygon.Count >= 3 && PointInPolygon(p.Lat, p.Lon, r.Polygon))
                return true;
        }
        return false;
    }

    private static bool PointInPolygon(double lat, double lon, List<double[]> poly)
    {
        var inside = false;
        for (int i = 0, j = poly.Count - 1; i < poly.Count; j = i++)
        {
            var xi = poly[i][1];
            var yi = poly[i][0];
            var xj = poly[j][1];
            var yj = poly[j][0];
            var hit = ((yi > lat) != (yj > lat))
                      && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
            if (hit) inside = !inside;
        }
        return inside;
    }

    private static double HaversineMeters(double lat1, double lon1, double lat2, double lon2)
    {
        const double R = 6371000;
        var p1 = lat1 * Math.PI / 180;
        var p2 = lat2 * Math.PI / 180;
        var dp = (lat2 - lat1) * Math.PI / 180;
        var dl = (lon2 - lon1) * Math.PI / 180;
        var a = Math.Sin(dp / 2) * Math.Sin(dp / 2) +
                Math.Cos(p1) * Math.Cos(p2) * Math.Sin(dl / 2) * Math.Sin(dl / 2);
        return R * 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
    }

    private static string BuildReason(Restriction r, TruckProfile t)
    {
        var reasons = new List<string>();
        if (r.MaxWeightTons is not null && t.GrossWeightTons > r.MaxWeightTons)
            reasons.Add($"masa {t.GrossWeightTons}t > {r.MaxWeightTons}t");
        if (r.MaxHeightMeters is not null && t.HeightMeters > r.MaxHeightMeters)
            reasons.Add($"visina {t.HeightMeters}m > {r.MaxHeightMeters}m");
        if (r.MaxWidthMeters is not null && t.WidthMeters > r.MaxWidthMeters)
            reasons.Add($"širina {t.WidthMeters}m > {r.MaxWidthMeters}m");
        if (r.MaxLengthMeters is not null && t.LengthMeters > r.MaxLengthMeters)
            reasons.Add($"dužina {t.LengthMeters}m > {r.MaxLengthMeters}m");
        if (r.HgvBan && t.IsHgv) reasons.Add("HGV zabrana");
        if (r.HazmatBan && !string.IsNullOrWhiteSpace(t.AdrClass)) reasons.Add($"ADR {t.AdrClass}");
        return string.Join("; ", reasons);
    }
}