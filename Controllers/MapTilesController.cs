using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Net.Http.Headers;

namespace ProMapCargo.Api.Controllers;

[ApiController]
[Route("api/map")]
public sealed class MapTilesController : ControllerBase
{
    private static readonly HashSet<string> AllowedLayers =
        new(StringComparer.OrdinalIgnoreCase)
        {
            "flow",
            "incidents",
            "dark",
            "satellite"
        };

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IMemoryCache _cache;
    private readonly IConfiguration _configuration;
    private readonly ILogger<MapTilesController> _logger;

    public MapTilesController(
        IHttpClientFactory httpClientFactory,
        IMemoryCache cache,
        IConfiguration configuration,
        ILogger<MapTilesController> logger)
    {
        _httpClientFactory = httpClientFactory;
        _cache = cache;
        _configuration = configuration;
        _logger = logger;
    }

    [HttpGet("tiles/{layer}/{zoom:int}/{x:int}/{y:int}.png")]
    public async Task<IActionResult> Tile(
        string layer,
        int zoom,
        int x,
        int y,
        CancellationToken cancellationToken)
    {
        if (!AllowedLayers.Contains(layer))
            return NotFound();

        if (zoom is < 0 or > 20)
            return BadRequest("Invalid zoom.");

        var tileCount = 1L << zoom;

        if (tileCount > int.MaxValue || y < 0 || y >= tileCount)
            return BadRequest("Invalid tile coordinates.");

        x = NormalizeX(x, (int)tileCount);

        var normalizedLayer = layer.ToLowerInvariant();
        var cacheKey = $"promap-map:{normalizedLayer}:{zoom}:{x}:{y}";
        var cacheSeconds = GetCacheSeconds(normalizedLayer);

        if (_cache.TryGetValue(cacheKey, out byte[]? cached) &&
            cached is { Length: > 0 })
        {
            SetCacheHeaders(cacheSeconds);
            return File(cached, "image/png");
        }

        var providerY =
            normalizedLayer is "flow" or "incidents" or "dark"
                ? (int)(tileCount - 1 - y)
                : y;

        var targetUrl = BuildTargetUrl(
            normalizedLayer,
            zoom,
            x,
            providerY);

        if (targetUrl is null)
        {
            return Problem(
                title: "Map layer is not configured",
                detail: $"Layer '{normalizedLayer}' requires server-side configuration.",
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        try
        {
            var client = _httpClientFactory.CreateClient("MapTiles");

            using var response = await client.GetAsync(
                targetUrl,
                HttpCompletionOption.ResponseHeadersRead,
                cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning(
                    "Map provider returned HTTP {StatusCode} for {Layer}.",
                    (int)response.StatusCode,
                    normalizedLayer);

                return StatusCode(
                    StatusCodes.Status502BadGateway,
                    new { message = "Map provider is unavailable." });
            }

            var mediaType =
                response.Content.Headers.ContentType?.MediaType;

            if (!IsImage(mediaType))
            {
                _logger.LogWarning(
                    "Unexpected map content type {ContentType} for {Layer}.",
                    mediaType,
                    normalizedLayer);

                return StatusCode(
                    StatusCodes.Status502BadGateway,
                    new { message = "Map provider returned an invalid tile." });
            }

            var bytes = await response.Content.ReadAsByteArrayAsync(
                cancellationToken);

            if (bytes.Length == 0)
            {
                return StatusCode(
                    StatusCodes.Status502BadGateway,
                    new { message = "Map provider returned an empty tile." });
            }

            _cache.Set(
                cacheKey,
                bytes,
                TimeSpan.FromSeconds(cacheSeconds));

            SetCacheHeaders(cacheSeconds);

            return File(bytes, mediaType ?? "image/png");
        }
        catch (OperationCanceledException)
            when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (HttpRequestException ex)
        {
            _logger.LogWarning(
                ex,
                "Map provider request failed for {Layer}.",
                normalizedLayer);

            return StatusCode(
                StatusCodes.Status502BadGateway,
                new { message = "Map provider connection failed." });
        }
    }

    [HttpGet("config")]
    public IActionResult Config()
    {
        var hasKey = HasTomTomKey();

        return Ok(new
        {
            layers = new[]
            {
                new
                {
                    id = "flow",
                    enabled = hasKey,
                    type = "overlay",
                    label = "Traffic flow",
                    maxZoom = 19,
                    attribution = "TomTom"
                },
                new
                {
                    id = "incidents",
                    enabled = hasKey,
                    type = "overlay",
                    label = "Traffic incidents",
                    maxZoom = 19,
                    attribution = "TomTom"
                },
                new
                {
                    id = "dark",
                    enabled = hasKey,
                    type = "base",
                    label = "TomTom Dark",
                    maxZoom = 19,
                    attribution = "TomTom"
                },
                new
                {
                    id = "satellite",
                    enabled = true,
                    type = "base",
                    label = "Satellite",
                    maxZoom = 19,
                    attribution = "Tiles © Esri"
                }
            },
            proxy = "/api/map/tiles/{layer}/{z}/{x}/{y}.png"
        });
    }

    private string? BuildTargetUrl(
        string layer,
        int zoom,
        int x,
        int providerY)
    {
        var apiKey = _configuration["TomTom:ApiKey"];
        var style = _configuration["TomTom:TrafficStyle"] ?? "absolute";
        var language = _configuration["TomTom:Language"];

        var languageQuery =
            string.IsNullOrWhiteSpace(language)
                ? string.Empty
                : $"&language={Uri.EscapeDataString(language)}";

        return layer switch
        {
            "flow" when !string.IsNullOrWhiteSpace(apiKey) =>
                $"https://api.tomtom.com/maps/orbis/traffic/flow/raster/tile/{zoom}/{x}/{providerY}?apiVersion=2&style={Uri.EscapeDataString(style)}&key={Uri.EscapeDataString(apiKey)}{languageQuery}",

            "incidents" when !string.IsNullOrWhiteSpace(apiKey) =>
                $"https://api.tomtom.com/maps/orbis/traffic/incidents/raster/tile/{zoom}/{x}/{providerY}?apiVersion=2&style={Uri.EscapeDataString(style)}&key={Uri.EscapeDataString(apiKey)}{languageQuery}",

            "dark" when !string.IsNullOrWhiteSpace(apiKey) =>
                $"https://api.tomtom.com/map/1/tile/basic/night/{zoom}/{x}/{providerY}.png?key={Uri.EscapeDataString(apiKey)}{languageQuery}",

            "satellite" =>
                $"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{zoom}/{providerY}/{x}",

            _ => null
        };
    }

    private bool HasTomTomKey() =>
        !string.IsNullOrWhiteSpace(_configuration["TomTom:ApiKey"]);

    private int GetCacheSeconds(string layer) =>
        layer switch
        {
            "flow" =>
                _configuration.GetValue("TomTom:CacheSeconds:Flow", 30),

            "incidents" =>
                _configuration.GetValue("TomTom:CacheSeconds:Incidents", 15),

            "dark" =>
                _configuration.GetValue("TomTom:CacheSeconds:Dark", 3600),

            "satellite" =>
                _configuration.GetValue("TomTom:CacheSeconds:Satellite", 86400),

            _ => 60
        };

    private void SetCacheHeaders(int seconds)
    {
        Response.Headers[HeaderNames.CacheControl] =
            $"public,max-age={seconds},stale-while-revalidate=30";
    }

    private static int NormalizeX(int x, int width)
    {
        var result = x % width;
        return result < 0 ? result + width : result;
    }

    private static bool IsImage(string? mediaType) =>
        string.Equals(mediaType, "image/png", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(mediaType, "image/jpeg", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(mediaType, "image/webp", StringComparison.OrdinalIgnoreCase);
}
