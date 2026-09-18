using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Net.Http.Headers;

namespace ProMapCargo.Api.Controllers;

[ApiController]
[Route("api/map")]
public sealed class MapTilesController : ControllerBase
{
    private static readonly HashSet<string> AllowedLayers = new(StringComparer.OrdinalIgnoreCase)
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
    [ResponseCache(Duration = 60, Location = ResponseCacheLocation.Any, NoStore = false)]
    public async Task<IActionResult> Tile(
        string layer,
        int zoom,
        int x,
        int y,
        CancellationToken cancellationToken)
    {
        if (!AllowedLayers.Contains(layer))
        {
            return NotFound();
        }

        if (zoom is < 0 or > 20)
        {
            return BadRequest("Invalid zoom.");
        }

        var maxTile = 1L << zoom;

        if (x < 0 || x >= maxTile || y < 0 || y >= maxTile)
        {
            return BadRequest("Invalid tile coordinates.");
        }

        var parsedY = (int)(maxTile - 1 - y);
        var cacheKey = $"promap-map:{layer.ToLowerInvariant()}:{zoom}:{x}:{y}";

        if (_cache.TryGetValue(cacheKey, out byte[]? cached) && cached is { Length: > 0 })
        {
            return File(cached, "image/png");
        }

        var targetUrl = BuildTargetUrl(layer, zoom, x, parsedY);

        if (targetUrl is null)
        {
            return Problem(
                title: "Map layer is not configured",
                detail: $"Layer '{layer}' requires server-side configuration.",
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
                    "Map provider returned HTTP {StatusCode} for layer {Layer}.",
                    (int)response.StatusCode,
                    layer);

                return StatusCode(
                    StatusCodes.Status502BadGateway,
                    new
                    {
                        message = "Map provider is unavailable.",
                        layer
                    });
            }

            var mediaType = response.Content.Headers.ContentType?.MediaType;

            if (!string.Equals(mediaType, "image/png", StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(mediaType, "image/jpeg", StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(mediaType, "image/webp", StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogWarning(
                    "Map provider returned unexpected content type {ContentType} for layer {Layer}.",
                    mediaType,
                    layer);

                return StatusCode(
                    StatusCodes.Status502BadGateway,
                    new { message = "Map provider returned an invalid tile." });
            }

            var bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken);

            if (bytes.Length == 0)
            {
                return StatusCode(
                    StatusCodes.Status502BadGateway,
                    new { message = "Map provider returned an empty tile." });
            }

            var cacheSeconds = GetCacheSeconds(layer);

            _cache.Set(
                cacheKey,
                bytes,
                new MemoryCacheEntryOptions
                {
                    AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(cacheSeconds),
                    Size = bytes.Length
                });

            Response.Headers[HeaderNames.CacheControl] = $"public,max-age={cacheSeconds},stale-while-revalidate=30";

            return File(bytes, mediaType ?? "image/png");
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (HttpRequestException ex)
        {
            _logger.LogWarning(ex, "Map provider request failed for layer {Layer}.", layer);

            return StatusCode(
                StatusCodes.Status502BadGateway,
                new { message = "Map provider connection failed.", layer });
        }
    }

    [HttpGet("config")]
    public IActionResult Config()
    {
        var configured = new[]
        {
            new { id = "flow", enabled = HasTomTomKey(), type = "overlay", label = "Traffic flow" },
            new { id = "incidents", enabled = HasTomTomKey(), type = "overlay", label = "Traffic incidents" },
            new { id = "dark", enabled = HasTomTomKey(), type = "base", label = "TomTom Dark" },
            new { id = "satellite", enabled = true, type = "base", label = "Satellite" }
        };

        return Ok(new
        {
            layers = configured,
            proxy = "/api/map/tiles/{layer}/{z}/{x}/{y}.png"
        });
    }

    private string? BuildTargetUrl(string layer, int zoom, int x, int parsedY)
    {
        var apiKey = _configuration["TomTom:ApiKey"];
        var style = _configuration["TomTom:TrafficStyle"] ?? "absolute";

        var queryString = BuildTomTomQueryString();

        return layer.ToLowerInvariant() switch
        {
            "flow" when !string.IsNullOrWhiteSpace(apiKey) =>
                $"https://api.tomtom.com/maps/orbis/traffic/flow/raster/tile/{zoom}/{x}/{parsedY}?apiVersion=2&style={Uri.EscapeDataString(style)}&key={Uri.EscapeDataString(apiKey)}{queryString}",

            "incidents" when !string.IsNullOrWhiteSpace(apiKey) =>
                $"https://api.tomtom.com/maps/orbis/traffic/incidents/raster/tile/{zoom}/{x}/{parsedY}?apiVersion=2&style={Uri.EscapeDataString(style)}&key={Uri.EscapeDataString(apiKey)}{queryString}",

            "dark" when !string.IsNullOrWhiteSpace(apiKey) =>
                $"https://api.tomtom.com/map/1/tile/basic/night/{zoom}/{x}/{parsedY}.png?key={Uri.EscapeDataString(apiKey)}{queryString}",

            "satellite" =>
                $"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{zoom}/{parsedY}/{x}",

            _ => null
        };
    }

    private string BuildTomTomQueryString()
    {
        var language = _configuration["TomTom:Language"];

        return string.IsNullOrWhiteSpace(language)
            ? string.Empty
            : $"&language={Uri.EscapeDataString(language)}";
    }

    private bool HasTomTomKey() =>
        !string.IsNullOrWhiteSpace(_configuration["TomTom:ApiKey"]);

    private int GetCacheSeconds(string layer) =>
        layer.ToLowerInvariant() switch
        {
            "flow" => _configuration.GetValue("TomTom:CacheSeconds:Flow", 30),
            "incidents" => _configuration.GetValue("TomTom:CacheSeconds:Incidents", 15),
            "dark" => _configuration.GetValue("TomTom:CacheSeconds:Dark", 3600),
            "satellite" => _configuration.GetValue("TomTom:CacheSeconds:Satellite", 86400),
            _ => 60
        };
}
