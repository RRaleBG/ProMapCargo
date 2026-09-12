using ProMapCargo.Api.Models;
using System.Globalization;
using System.Text.Json;
namespace ProMapCargo.Api.Services;

public sealed class OsrmRoutingService(HttpClient http, IConfiguration config) : IRoutingService
{
    public async Task<OsrmResponse> RouteAsync(RouteRequest request, CancellationToken ct)
    {
        var profile = request.Profile switch
        {
            "cycling" => "bike",
            "walking" => "foot",
            _ => "driving"
        }
        ;
        var baseUrl = config["Routing:OsrmBaseUrl"]?.TrimEnd('/');
        if (string.IsNullOrWhiteSpace(baseUrl))
        {
            return new OsrmResponse
            {
                Code = "NoOsrmEndpoint"
            }
            ;
        }
        var coords = string.Join(";", FormatCoordinate(request.Start), FormatCoordinate(request.Target));
        var url = $"{baseUrl}/route/v1/{profile}/{coords}?overview=full&geometries=geojson&steps=true&alternatives=true";
        using var response = await http.GetAsync(url, ct);
        if (!response.IsSuccessStatusCode)
        {
            return new OsrmResponse
            {
                Code = $"Http{(int)response.StatusCode}"
            }
            ;
        }
        return await response.Content.ReadFromJsonAsync<OsrmResponse>(
        new JsonSerializerOptions(JsonSerializerDefaults.Web), ct)
        ?? new OsrmResponse
        {
            Code = "InvalidResponse"
        }
        ;
    }
    private static string FormatCoordinate(GeoPoint point) =>
    $"{point.Lon.ToString(CultureInfo.InvariantCulture)},{point.Lat.ToString(CultureInfo.InvariantCulture)}";
}
