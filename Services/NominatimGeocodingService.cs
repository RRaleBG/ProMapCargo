using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;
using ProMapCargo.Api.Models;

namespace ProMapCargo.Api.Services;

public sealed class NominatimGeocodingService : IGeocodingService
{
    private readonly HttpClient _httpClient;
    private readonly IConfiguration _configuration;
    private readonly ILogger<NominatimGeocodingService> _logger;

    public NominatimGeocodingService(
        HttpClient httpClient,
        IConfiguration configuration,
        ILogger<NominatimGeocodingService> logger)
    {
        _httpClient = httpClient;
        _configuration = configuration;
        _logger = logger;

        var userAgent =
            configuration["Geocoding:UserAgent"]
            ?? "ProMapCargo/1.0 (truck navigation)";

        _httpClient.DefaultRequestHeaders.UserAgent.ParseAdd(userAgent);
    }

    public async Task<IReadOnlyList<GeocodingResult>> SearchAsync(
        string query,
        int limit = 6,
        CancellationToken cancellationToken = default)
    {
        limit = Math.Clamp(limit, 1, 10);

        var baseUrl =
            _configuration["Geocoding:NominatimBaseUrl"]
            ?? "https://nominatim.openstreetmap.org";

        baseUrl = baseUrl.TrimEnd('/');

        var url =
            $"{baseUrl}/search" +
            $"?format=jsonv2" +
            $"&addressdetails=1" +
            $"&accept-language=sr,en" +
            $"&limit={limit}" +
            $"&q={Uri.EscapeDataString(query)}";

        try
        {
            using var response =
                await _httpClient.GetAsync(url, cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning(
                    "Nominatim geocoding returned HTTP {StatusCode} for query {Query}",
                    response.StatusCode,
                    query);

                return Array.Empty<GeocodingResult>();
            }

            var items =
                await response.Content.ReadFromJsonAsync<
                    List<NominatimResult>>(
                    cancellationToken: cancellationToken);

            if (items is null)
                return Array.Empty<GeocodingResult>();

            return items
                .Select(x =>
                {
                    if (!double.TryParse(
                            x.Lat,
                            System.Globalization.NumberStyles.Float,
                            System.Globalization.CultureInfo.InvariantCulture,
                            out var lat))
                        return null;

                    if (!double.TryParse(
                            x.Lon,
                            System.Globalization.NumberStyles.Float,
                            System.Globalization.CultureInfo.InvariantCulture,
                            out var lon))
                        return null;

                    if (lat is < -90 or > 90 ||
                        lon is < -180 or > 180)
                        return null;

                    return new GeocodingResult(
                        Lat: lat,
                        Lon: lon,
                        DisplayName: x.DisplayName ?? query,
                        Type: x.Type,
                        Category: x.Class,
                        OsmType: x.OsmType,
                        OsmId: x.OsmId,
                        Importance: x.Importance);
                })
                .Where(x => x is not null)
                .Cast<GeocodingResult>()
                .ToList();
        }
        catch (OperationCanceledException)
            when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(
                ex,
                "Geocoding failed for query {Query}",
                query);

            return Array.Empty<GeocodingResult>();
        }
    }

    private sealed class NominatimResult
    {
        [JsonPropertyName("lat")]
        public string? Lat { get; set; }

        [JsonPropertyName("lon")]
        public string? Lon { get; set; }

        [JsonPropertyName("display_name")]
        public string? DisplayName { get; set; }

        [JsonPropertyName("type")]
        public string? Type { get; set; }

        [JsonPropertyName("class")]
        public string? Class { get; set; }

        [JsonPropertyName("osm_type")]
        public string? OsmType { get; set; }

        [JsonPropertyName("osm_id")]
        public long? OsmId { get; set; }

        [JsonPropertyName("importance")]
        public double? Importance { get; set; }
    }
}