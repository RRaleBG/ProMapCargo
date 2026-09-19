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
        var hasTomTomKey =
            !string.IsNullOrWhiteSpace(
                configuration["TomTom:ApiKey"]);

        return Ok(new
        {
            defaultBase = hasTomTomKey
                ? "dark"
                : "osm",

            layers = new[]
            {
                new
                {
                    id = "dark",
                    label = "TomTom Dark",
                    type = "base",
                    enabled = hasTomTomKey
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
                    enabled = hasTomTomKey
                },

                new
                {
                    id = "incidents",
                    label = "Traffic Incidents",
                    type = "overlay",
                    enabled = hasTomTomKey
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

        /*
         * Leaflet / TomTom Orbis:
         *
         * XYZ tile scheme
         * Z = zoom
         * X = column
         * Y = row
         *
         * TomTom Orbis supports zoom levels up to 22.
         */
        if (zoom < 0 || zoom > 22)
        {
            return BadRequest("Invalid zoom.");
        }

        var tileCount = 1L << zoom;

        /*
         * Y must be inside the valid tile range.
         */
        if (y < 0 || y >= tileCount)
        {
            return BadRequest(
                "Invalid tile Y coordinate.");
        }

        /*
         * X wraps horizontally.
         */
        x = NormalizeX(
            x,
            checked((int)tileCount));

        var apiKey =
            configuration["TomTom:ApiKey"];

        var usesTomTom =
            layer == "dark"
            || layer == "flow"
            || layer == "incidents";

        /*
         * TomTom layers require the API key.
         */
        if (usesTomTom &&
            string.IsNullOrWhiteSpace(apiKey))
        {
            return StatusCode(
                StatusCodes.Status503ServiceUnavailable,
                new
                {
                    code = "map_provider_not_configured",
                    layer
                });
        }

        /*
         * Cache is based on the normalized XYZ tile.
         */
        var cacheKey =
            $"map:{layer}:{zoom}:{x}:{y}";

        if (cache.TryGetValue(
                cacheKey,
                out MapTile? cached)
            && cached is not null)
        {
            Response.Headers.CacheControl =
                $"public,max-age={GetCacheSeconds(layer)}";

            return File(
                cached.Bytes,
                cached.ContentType);
        }

        /*
         * IMPORTANT:
         *
         * Do NOT invert Y.
         *
         * Leaflet already gives us the correct XYZ Y.
         */
        var providerY = y;

        var url =
            BuildUrl(
                layer,
                zoom,
                x,
                providerY);

        if (url is null)
        {
            return NotFound();
        }

        try
        {
            var client =
                httpClientFactory
                    .CreateClient("MapTiles");

            using var request =
                new HttpRequestMessage(
                    HttpMethod.Get,
                    url);

            /*
             * Keep TomTom API key on the server.
             *
             * It is never exposed to Leaflet.
             */
            if (usesTomTom &&
                !string.IsNullOrWhiteSpace(apiKey))
            {
                request.Headers.TryAddWithoutValidation(
                    "TomTom-Api-Key",
                    apiKey);
            }

            request.Headers.TryAddWithoutValidation(
                "Accept",
                "image/png,image/*;q=0.9,*/*;q=0.8");

            using var response =
                await client.SendAsync(
                    request,
                    HttpCompletionOption.ResponseHeadersRead,
                    ct);

            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning(
                    "Map provider request failed: " +
                    "{Layer} {Zoom}/{X}/{Y}, HTTP {StatusCode}",
                    layer,
                    zoom,
                    x,
                    y,
                    (int)response.StatusCode);

                return StatusCode(
                    (int)response.StatusCode);
            }

            var contentType =
                response.Content.Headers
                    .ContentType?
                    .MediaType;

            /*
             * We expect an image tile.
             */
            if (string.IsNullOrWhiteSpace(contentType)
                || !contentType.StartsWith(
                    "image/",
                    StringComparison.OrdinalIgnoreCase))
            {
                logger.LogWarning(
                    "Map provider returned invalid " +
                    "content type {ContentType} for " +
                    "{Layer} {Zoom}/{X}/{Y}.",
                    contentType,
                    layer,
                    zoom,
                    x,
                    y);

                return StatusCode(
                    StatusCodes.Status502BadGateway);
            }

            var bytes =
                await response.Content
                    .ReadAsByteArrayAsync(ct);

            if (bytes.Length == 0)
            {
                logger.LogWarning(
                    "Map provider returned empty tile " +
                    "for {Layer} {Zoom}/{X}/{Y}.",
                    layer,
                    zoom,
                    x,
                    y);

                return StatusCode(
                    StatusCodes.Status502BadGateway);
            }

            var tile =
                new MapTile(
                    bytes,
                    contentType);

            var cacheSeconds =
                GetCacheSeconds(layer);

            cache.Set(
                cacheKey,
                tile,
                TimeSpan.FromSeconds(
                    cacheSeconds));

            /*
             * Browser-side cache.
             */
            Response.Headers.CacheControl =
                $"public,max-age={cacheSeconds}";

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
                "Map tile proxy failed for " +
                "{Layer} {Zoom}/{X}/{Y}.",
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
    int zoom,
    int x,
    int y)
    {
        var apiKey = configuration["TomTom:ApiKey"];

        if (string.IsNullOrWhiteSpace(apiKey) && layer != "satellite")
        {
            return null;
        }

        var style =  configuration["TomTom:ApiKey"]
            ?? "dark";

        style =
            style.Equals(
                "light",
                StringComparison.OrdinalIgnoreCase)
                ? "light"
                : "dark";

        var escapedKey =
            Uri.EscapeDataString(
                apiKey ?? string.Empty);

        return layer switch
        {
            "flow" =>
                $"https://api.tomtom.com/maps/orbis/traffic/flow/raster/tile/" +
                $"{zoom}/{x}/{y}" +
                $"?apiVersion=2&style={style}&key={escapedKey}",

            "incidents" =>
                $"https://api.tomtom.com/maps/orbis/traffic/incidents/raster/tile/" +
                $"{zoom}/{x}/{y}" +
                $"?apiVersion=2&style={style}&key={escapedKey}",

            "dark" =>
                $"https://api.tomtom.com/map/1/tile/basic/night/" +
                $"{zoom}/{x}/{y}.png?key={escapedKey}",

            "satellite" =>
                $"https://server.arcgisonline.com/ArcGIS/rest/services/" +
                $"World_Imagery/MapServer/tile/{zoom}/{y}/{x}",

            _ => null
        };
    }



    private static int GetCacheSeconds(
        string layer)
    {
        return layer switch
        {
            /*
             * Traffic changes frequently.
             */
            "flow" => 30,

            /*
             * Incidents should refresh more frequently.
             */
            "incidents" => 15,

            /*
             * Base map changes much less frequently.
             */
            "dark" => 3600,

            /*
             * Satellite imagery is relatively static.
             */
            "satellite" => 86400,

            _ => 60
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