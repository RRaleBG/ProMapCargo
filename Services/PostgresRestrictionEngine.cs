using ProMapCargo.Api.Models;

namespace ProMapCargo.Api.Services;

public sealed class PostgresRestrictionEngine(IPostgresRestrictionRepository repository)
: IRestrictionEngine
{
    public async Task<IReadOnlyList<RestrictionViolation>> Analyze(
        IEnumerable<GeoPoint> routePoints,
        TruckProfile? truck,
        DateTimeOffset? departureAt)
    {
        if (truck is null) return [];
        var points = routePoints.ToList();
        var restrictions = await repository.FindNearRouteAsync(points, 80, CancellationToken.None);
        var result = new List<RestrictionViolation>();
        foreach (var r in restrictions)
        {
            if (!Applies(r, truck, departureAt)) continue;
            result.Add(new RestrictionViolation
            {
                Id = r.Id.ToString(),
                Name = string.IsNullOrWhiteSpace(r.Name) ? $"OSM way {r.OsmWayId}" : r.Name,
                Type = r.RestrictionType,
                Reason = Reason(r, truck)
            });
        }
        return result;
    }

    private static bool Applies(RoadRestriction r, TruckProfile t, DateTimeOffset? departureAt)
    {
        if (r.HgvBan && t.IsHgv) return true;
        if (r.HazmatBan && !string.IsNullOrWhiteSpace(t.AdrClass)) return true;
        if (r.MaxWeightTons is not null && t.GrossWeightTons > r.MaxWeightTons) return true;
        if (r.MaxHeightMeters is not null && t.HeightMeters > r.MaxHeightMeters) return true;
        if (r.MaxWidthMeters is not null && t.WidthMeters > r.MaxWidthMeters) return true;
        if (r.MaxLengthMeters is not null && t.LengthMeters > r.MaxLengthMeters) return true;
        if (r.MaxAxleLoadTons is not null && t.AxleLoadTons > r.MaxAxleLoadTons) return true;
        if (departureAt is not null && r.TimeFrom is not null && r.TimeTo is not null)
        {
            var time = departureAt.Value.TimeOfDay;
            var active = r.TimeFrom <= r.TimeTo
            ? time >= r.TimeFrom && time <= r.TimeTo
            : time >= r.TimeFrom || time <= r.TimeTo;
            if (active) return true;
        }
        return false;
    }

    private static string Reason(RoadRestriction r, TruckProfile t)
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
        if (r.MaxAxleLoadTons is not null && t.AxleLoadTons > r.MaxAxleLoadTons)
            reasons.Add($"osovinsko opterećenje {t.AxleLoadTons}t > {r.MaxAxleLoadTons}t");
        if (r.HgvBan && t.IsHgv) reasons.Add("HGV zabrana");
        if (r.HazmatBan && !string.IsNullOrWhiteSpace(t.AdrClass)) reasons.Add($"ADR {t.AdrClass}");
        if (r.TimeFrom is not null && r.TimeTo is not null)
            reasons.Add($"vremensko ograničenje {r.TimeFrom}-{r.TimeTo}");
        return string.Join("; ", reasons);
    }
}