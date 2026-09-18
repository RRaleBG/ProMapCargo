using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;

namespace ProMapCargo.Api.Controllers;

[ApiController]
[Route("api/map")]
public sealed class MapTilesController(
    IHttpClientFactory httpClientFactory,
    IMemoryCache cache,
    IConfiguration configuration,
    ILogger<MapTilesController> logger) : ControllerBase
{
    private static readonly HashSet<string> Layers =
        new(StringComparer.OrdinalIgnoreCase)
        {
            "dark",
            "satellite",
            "flow",
            "incidents"
        };

    [HttpGet("config")]
    public IActionResult Config()
    {
        var hasKey =
            !string.IsNullOrWhiteSpace(
                configuration["TomTom:ApiKey"]);

        return Ok(new
        {
            defaultBase = hasKey ? "dark" : "osm",

            layers = new[]
            {
                new
                {
                    id = "dark",
                    label = "TomTom Dark",
                    type = "base",
                    enabled = hasKey
                },

                new
                {
                    id = "osm",
                    label = "OSM Light",
                    type = "base",
                    enabled = true
                },

                new
                {
                    id = "satellite",
                    label = "Satellite",
                    type = "base",
                    enabled = true
                },

                new
                {
                    id = "flow",
                    label = "Traffic Flow",
                    type = "overlay",
                    enabled = hasKey
                },

                new
                {
                    id = "incidents",
                    label = "Traffic Incidents",
                    type = "overlay",
                    enabled = hasKey
                }
            }
        });
    }

    [HttpGet("tiles/{layer}/{zoom:int}/{x:int}/{y:int}.png")]
    public async Task<IActionResult> Tile(
        string layer,
        int zoom,
        int x,
        int y,
        CancellationToken ct)
    {
        layer = layer.ToLowerInvariant();

        if (!Layers.Contains(layer))
        {
            return NotFound();
        }

        if (zoom < 0 || zoom > 20)
        {
            return BadRequest("Invalid zoom.");
        }

        var count = 1L << zoom;

        if (y < 0 || y >= count)
        {
            return BadRequest(
                "Invalid tile Y coordinate.");
        }

        x = NormalizeX(
            x,
            checked((int)count));

        var key =
            configuration["TomTom:ApiKey"];

        var usesTomTom =
            layer == "dark"
            || layer == "flow"
            || layer == "incidents";

        if (usesTomTom &&
            string.IsNullOrWhiteSpace(key))
        {
            return StatusCode(
                StatusCodes.Status503ServiceUnavailable,
                new
                {
                    code =
                        "map_provider_not_configured"
                });
        }

        var cacheKey =
            $"map:{layer}:{zoom}:{x}:{y}";

        if (cache.TryGetValue(
                cacheKey,
                out MapTile? cached)
            && cached is not null)
        {
            return File(
                cached.Bytes,
                cached.ContentType);
        }

        var providerY =
            usesTomTom
                ? checked((int)(count - 1 - y))
                : y;

        var url =
            BuildUrl(
                layer,
                zoom,
                x,
                providerY,
                key ?? string.Empty);

        if (url is null)
        {
            return NotFound();
        }

        try
        {
            var client =
                httpClientFactory
                    .CreateClient("MapTiles");

            using var response =
                await client.GetAsync(
                    url,
                    HttpCompletionOption.ResponseHeadersRead,
                    ct);

            if (!response.IsSuccessStatusCode)
            {
                return StatusCode(
                    (int)response.StatusCode);
            }

            var contentType =
                response.Content.Headers
                    .ContentType?
                    .MediaType;

            if (string.IsNullOrWhiteSpace(contentType)
                || !contentType.StartsWith(
                    "image/",
                    StringComparison.OrdinalIgnoreCase))
            {
                return StatusCode(
                    StatusCodes.Status502BadGateway);
            }

            var bytes =
                await response.Content
                    .ReadAsByteArrayAsync(ct);

            if (bytes.Length == 0)
            {
                return StatusCode(
                    StatusCodes.Status502BadGateway);
            }

            var tile =
                new MapTile(
                    bytes,
                    contentType);

            var cacheSeconds =
                layer switch
                {
                    "flow" => 30,
                    "incidents" => 15,
                    "dark" => 3600,
                    "satellite" => 86400,
                    _ => 60
                };

            cache.Set(
                cacheKey,
                tile,
                TimeSpan.FromSeconds(
                    cacheSeconds));

            return File(
                bytes,
                contentType);
        }
        catch (OperationCanceledException)
            when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger.LogWarning(
                ex,
                "Map tile proxy failed for {Layer} {Zoom}/{X}/{Y}.",
                layer,
                zoom,
                x,
                y);

            return StatusCode(
                StatusCodes.Status502BadGateway);
        }
    }

    private string? BuildUrl(
        string layer,
        int z,
        int x,
        int y,
        string key)
    {
        var escapedKey =
            Uri.EscapeDataString(key);

        var style =
            Uri.EscapeDataString(
                configuration["TomTom:TrafficStyle"]
                ?? "absolute");

        return layer switch
        {
            "dark" =>
                $"https://api.tomtom.com/map/1/tile/basic/night/{z}/{x}/{y}.png?key={escapedKey}",

            "flow" =>
                $"https://api.tomtom.com/maps/orbis/traffic/flow/raster/tile/{z}/{x}/{y}?apiVersion=2&style={style}&key={escapedKey}",

            "incidents" =>
                $"https://api.tomtom.com/maps/orbis/traffic/incidents/raster/tile/{z}/{x}/{y}?apiVersion=2&style={style}&key={escapedKey}",

            "satellite" =>
                $"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",

            _ => null
        };
    }

    private static int NormalizeX(
        int x,
        int count)
    {
        var value =
            x % count;

        return value < 0
            ? value + count
            : value;
    }

    private sealed record MapTile(
        byte[] Bytes,
        string ContentType);
}