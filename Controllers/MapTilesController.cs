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
        {
            return NotFound();
        }

        if (zoom < 0 || zoom > 20)
        {
            return BadRequest("Invalid zoom.");
        }

        var tileCount = 1L << zoom;

        if (y < 0 || y >= tileCount)
        {
            return BadRequest("Invalid tile Y coordinate.");
        }

        x = NormalizeX(
            x,
            checked((int)tileCount));

        var normalizedLayer =
            layer.ToLowerInvariant();

        var cacheKey = $"promap-map:{normalizedLayer}:{zoom}:{x}:{y}";

        var cacheSeconds = GetCacheSeconds(normalizedLayer);

        if (_cache.TryGetValue(cacheKey, out MapTileCacheEntry? cached) && cached is not null && cached.Bytes.Length > 0)
        {
            SetCacheHeaders(cacheSeconds);

            return File(
                cached.Bytes,
                cached.ContentType);
        }

        var providerY = normalizedLayer is "flow" or "incidents" or "dark" ? (int)(tileCount - 1 - y) : y;
        var targetUrl = BuildTargetUrl(normalizedLayer, zoom, x, providerY);

        if (targetUrl is null)
        {
            return Problem(
                title: "Map layer is not configured",
                detail:
                    $"Layer '{normalizedLayer}' requires server-side configuration.",
                statusCode:
                    StatusCodes.Status503ServiceUnavailable);
        }

        try
        {
            var client =
                _httpClientFactory.CreateClient(
                    "MapTiles");

            using var response =
                await client.GetAsync(
                    targetUrl,
                    HttpCompletionOption.ResponseHeadersRead,
                    cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning(
                    "Map provider returned HTTP {StatusCode} for layer {Layer}.",
                    (int)response.StatusCode,
                    normalizedLayer);

                return StatusCode(
                    StatusCodes.Status502BadGateway,
                    new
                    {
                        message =
                            "Map provider is unavailable.",
                        layer =
                            normalizedLayer
                    });
            }

            var mediaType =
                response
                    .Content
                    .Headers
                    .ContentType
                    ?.MediaType;

            if (!IsImage(mediaType))
            {
                _logger.LogWarning(
                    "Map provider returned invalid content type {ContentType} for {Layer}.",
                    mediaType,
                    normalizedLayer);

                return StatusCode(
                    StatusCodes.Status502BadGateway,
                    new
                    {
                        message =
                            "Map provider returned an invalid tile.",
                        layer =
                            normalizedLayer
                    });
            }

            var bytes =
                await response.Content.ReadAsByteArrayAsync(
                    cancellationToken);

            if (bytes.Length == 0)
            {
                return StatusCode(
                    StatusCodes.Status502BadGateway,
                    new
                    {
                        message =
                            "Map provider returned an empty tile.",
                        layer =
                            normalizedLayer
                    });
            }

            var contentType =
                mediaType ??
                "image/png";

            _cache.Set(
                cacheKey,
                new MapTileCacheEntry(
                    bytes,
                    contentType),
                new MemoryCacheEntryOptions
                {
                    AbsoluteExpirationRelativeToNow =
                        TimeSpan.FromSeconds(cacheSeconds),

                    Size =
                        bytes.Length
                });

            SetCacheHeaders(cacheSeconds);

            return File(
                bytes,
                contentType);
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
                "Map provider request failed for layer {Layer}.",
                normalizedLayer);

            return StatusCode(
                StatusCodes.Status502BadGateway,
                new
                {
                    message =
                        "Map provider connection failed.",
                    layer =
                        normalizedLayer
                });
        }
        catch (TaskCanceledException ex)
        {
            _logger.LogWarning(
                ex,
                "Map provider timeout for layer {Layer}.",
                normalizedLayer);

            return StatusCode(
                StatusCodes.Status504GatewayTimeout,
                new
                {
                    message =
                        "Map provider request timed out.",
                    layer =
                        normalizedLayer
                });
        }
    }

    [HttpGet("config")]
    public IActionResult Config()
    {
        var hasTomTomKey =
            HasTomTomKey();

        return Ok(
            new
            {
                proxy =
                    "/api/map/tiles/{layer}/{z}/{x}/{y}.png",

                layers =
                    new[]
                    {
                        new
                        {
                            id =
                                "dark",

                            enabled =
                                hasTomTomKey,

                            type =
                                "base",

                            label =
                                "TomTom Dark",

                            maxZoom =
                                19,

                            attribution =
                                "© TomTom"
                        },

                        new
                        {
                            id =
                                "satellite",

                            enabled =
                                true,

                            type =
                                "base",

                            label =
                                "Satellite",

                            maxZoom =
                                19,

                            attribution =
                                "Tiles © Esri"
                        },

                        new
                        {
                            id =
                                "flow",

                            enabled =
                                hasTomTomKey,

                            type =
                                "overlay",

                            label =
                                "Traffic Flow",

                            maxZoom =
                                19,

                            attribution =
                                "© TomTom"
                        },

                        new
                        {
                            id =
                                "incidents",

                            enabled =
                                hasTomTomKey,

                            type =
                                "overlay",

                            label =
                                "Traffic Incidents",

                            maxZoom =
                                19,

                            attribution =
                                "© TomTom"
                        }
                    }
            });
    }

    private string? BuildTargetUrl(
        string layer,
        int zoom,
        int x,
        int providerY)
    {
        var apiKey =
            _configuration[
                "TomTom:ApiKey"];

        var trafficStyle =
            _configuration[
                "TomTom:TrafficStyle"]
            ?? "absolute";

        var language =
            _configuration[
                "TomTom:Language"];

        var languageQuery =
            string.IsNullOrWhiteSpace(language)
                ? string.Empty
                : "&language=" +
                  Uri.EscapeDataString(language);

        var encodedKey =
            string.IsNullOrWhiteSpace(apiKey)
                ? null
                : Uri.EscapeDataString(apiKey);

        var encodedStyle =
            Uri.EscapeDataString(
                trafficStyle);

        return layer switch
        {
            "flow"
                when !string.IsNullOrWhiteSpace(encodedKey)
                =>
                $"https://api.tomtom.com/maps/orbis/traffic/flow/raster/tile/{zoom}/{x}/{providerY}" +
                $"?apiVersion=2" +
                $"&style={encodedStyle}" +
                $"&key={encodedKey}" +
                languageQuery,

            "incidents"
                when !string.IsNullOrWhiteSpace(encodedKey)
                =>
                $"https://api.tomtom.com/maps/orbis/traffic/incidents/raster/tile/{zoom}/{x}/{providerY}" +
                $"?apiVersion=2" +
                $"&style={encodedStyle}" +
                $"&key={encodedKey}" +
                languageQuery,

            "dark"
                when !string.IsNullOrWhiteSpace(encodedKey)
                =>
                $"https://api.tomtom.com/map/1/tile/basic/night/{zoom}/{x}/{providerY}.png" +
                $"?key={encodedKey}" +
                languageQuery,

            "satellite"
                =>
                $"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{zoom}/{providerY}/{x}",

            _ =>
                null
        };
    }

    private bool HasTomTomKey()
    {
        return !string.IsNullOrWhiteSpace(
            _configuration[
                "TomTom:ApiKey"]);
    }

    private int GetCacheSeconds(
        string layer)
    {
        return layer switch
        {
            "flow" =>
                Math.Clamp(
                    _configuration.GetValue(
                        "TomTom:CacheSeconds:Flow",
                        30),
                    5,
                    300),

            "incidents" =>
                Math.Clamp(
                    _configuration.GetValue(
                        "TomTom:CacheSeconds:Incidents",
                        15),
                    5,
                    300),

            "dark" =>
                Math.Clamp(
                    _configuration.GetValue(
                        "TomTom:CacheSeconds:Dark",
                        3600),
                    60,
                    86400),

            "satellite" =>
                Math.Clamp(
                    _configuration.GetValue(
                        "TomTom:CacheSeconds:Satellite",
                        86400),
                    300,
                    604800),

            _ =>
                60
        };
    }

    private void SetCacheHeaders(
        int seconds)
    {
        Response.Headers[
            HeaderNames.CacheControl] =
            $"public,max-age={seconds},stale-while-revalidate=30";
    }

    private static int NormalizeX(
        int x,
        int width)
    {
        var result =
            x % width;

        return result < 0
            ? result + width
            : result;
    }

    private static bool IsImage(
        string? mediaType)
    {
        return
            string.Equals(
                mediaType,
                "image/png",
                StringComparison.OrdinalIgnoreCase)
            ||
            string.Equals(
                mediaType,
                "image/jpeg",
                StringComparison.OrdinalIgnoreCase)
            ||
            string.Equals(
                mediaType,
                "image/webp",
                StringComparison.OrdinalIgnoreCase);
    }

    private sealed record MapTileCacheEntry(
        byte[] Bytes,
        string ContentType);
}