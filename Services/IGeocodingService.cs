using ProMapCargo.Api.Models;

namespace ProMapCargo.Api.Services;

public interface IGeocodingService
{
    Task<IReadOnlyList<GeocodingResult>> SearchAsync(
        string query,
        int limit = 6,
        CancellationToken cancellationToken = default);
}