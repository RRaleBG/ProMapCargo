using ProMapCargo.Api.Models;

namespace ProMapCargo.Api.Services;

public interface IRestrictionEngine
{
    Task<IReadOnlyList<RestrictionViolation>> Analyze(
        IEnumerable<GeoPoint> routePoints,
        TruckProfile? truck,
        DateTimeOffset? departureAt);
}