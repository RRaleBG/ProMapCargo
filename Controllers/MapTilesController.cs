using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;

namespace ProMapCargo.Api.Controllers;

[ApiController]
[Route("api/map")]
public sealed class MapTilesController(
    IHttpClientFactory httpClientFactory,
    IMemoryCache cache,
    IConfiguration configuration,
    IWebHostEnvironment environment,
    ILogger<MapTilesController> logger) : ControllerBase
{
    private const string LocalTomTomStyleFile =
        "street_driving_dark_orbis_draft.json";

    private const string LocalTomTomStyleUrl =
        "/styles/street_driving_dark_orbis_draft.json";

    private const string TomTomHost =
        "api.tomtom.com";

    private static readonly HashSet<string> Layers =
        new(StringComparer.OrdinalIgnoreCase)
        {
            "dark",
            "satellite",
            "flow",
            "incidents"
        };

    // ============================================================
    // PATH HELPERS
    // ============================================================

    private string TomTomStyleFilePath()
    {
        var webRoot =
            environment.WebRootPath;

        if (string.IsNullOrWhiteSpace(webRoot))
        {
            webRoot =
                Path.Combine(
                    environment.ContentRootPath,
                    "wwwroot");
        }

        return Path.Combine(
            webRoot,
            "styles",
            LocalTomTomStyleFile);
    }

    // ============================================================
    // MAP CONFIG
    // ============================================================

    [HttpGet("config")]
    public IActionResult Config()
    {
        var hasTomTomKey =
            !string.IsNullOrWhiteSpace(
                configuration["TomTom:ApiKey"]);

        var styleExists =
            System.IO.File.Exists(
                TomTomStyleFilePath());

        return Ok(new
        {
            defaultBase =
                hasTomTomKey &&
                styleExists
                    ? "tomtom-custom"
                    : "osm",

            customStyleUrl =
                styleExists
                    ? LocalTomTomStyleUrl
                    : null,

            customStyleConfigured =
                styleExists,

            customStyleProvider =
                "TomTom",

            customStyleName =
                "Dark Driving",

            customStyleVersion =
                "Draft",

            customStyleFile =
                LocalTomTomStyleUrl,

            layers = new[]
            {
                new
                {
                    id = "tomtom-custom",
                    label = "TomTom Dark · Custom",
                    type = "base",
                    enabled =
                        hasTomTomKey &&
                        styleExists
                },

                new
                {
                    id = "dark",
                    label = "TomTom Dark Raster",
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

    // ============================================================
    // LOCAL TOMTOM CUSTOM STYLE
    // ============================================================

    [HttpGet("tomtom/style")]
    public async Task<IActionResult> TomTomStyle(
        CancellationToken ct)
    {
        var stylePath =
            TomTomStyleFilePath();

        if (!System.IO.File.Exists(stylePath))
        {
            logger.LogError(
                "TomTom custom style file not found: {Path}",
                stylePath);

            return NotFound(
                new
                {
                    code =
                        "tomtom_local_style_not_found",

                    file =
                        LocalTomTomStyleFile,

                    path =
                        stylePath
                });
        }

        var apiKey =
            configuration["TomTom:ApiKey"];

        if (string.IsNullOrWhiteSpace(apiKey))
        {
            return StatusCode(
                StatusCodes.Status503ServiceUnavailable,
                new
                {
                    code =
                        "tomtom_api_key_missing"
                });
        }

        const string cacheKey =
            "promap-local-tomtom-dark-style";

        if (
            cache.TryGetValue(
                cacheKey,
                out string? cachedStyle
            ) &&
            !string.IsNullOrWhiteSpace(
                cachedStyle)
        )
        {
            Response.Headers.CacheControl =
                "public,max-age=60";

            return Content(
                cachedStyle,
                "application/json");
        }

        try
        {
            var json =
                await System.IO.File.ReadAllTextAsync(
                    stylePath,
                    ct);

            if (string.IsNullOrWhiteSpace(
                    json))
            {
                return StatusCode(
                    StatusCodes.Status502BadGateway,
                    new
                    {
                        code =
                            "tomtom_local_style_empty"
                    });
            }

            JsonDocument document;

            try
            {
                document =
                    JsonDocument.Parse(json);
            }
            catch (JsonException ex)
            {
                logger.LogError(
                    ex,
                    "Invalid local TomTom style JSON: {Path}",
                    stylePath);

                return StatusCode(
                    StatusCodes.Status502BadGateway,
                    new
                    {
                        code =
                            "tomtom_local_style_invalid_json"
                    });
            }

            using (document)
            {
                var root =
                    document.RootElement;

                if (
                    root.ValueKind !=
                    JsonValueKind.Object
                )
                {
                    return StatusCode(
                        StatusCodes.Status502BadGateway,
                        new
                        {
                            code =
                                "tomtom_local_style_invalid_root"
                        });
                }

                var version =
                    root.TryGetProperty(
                        "version",
                        out var versionProperty)
                        ? versionProperty
                            .GetInt32()
                        : 0;

                if (version != 8)
                {
                    return StatusCode(
                        StatusCodes.Status502BadGateway,
                        new
                        {
                            code =
                                "tomtom_local_style_not_maplibre_v8",

                            version
                        });
                }

                /*
                 * Proxy URL-ove koji se već nalaze
                 * u local style JSON-u.
                 *
                 * API key nikada ne izlazi u browser.
                 */
                var rewritten =
                    RewriteTomTomResources(
                        root);

                var output =
                    JsonSerializer.Serialize(
                        rewritten,
                        new JsonSerializerOptions
                        {
                            WriteIndented = false
                        });

                cache.Set(
                    cacheKey,
                    output,
                    TimeSpan.FromMinutes(5));

                Response.Headers.CacheControl =
                    "public,max-age=60";

                return Content(
                    output,
                    "application/json");
            }
        }
        catch (OperationCanceledException)
            when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger.LogError(
                ex,
                "Local TomTom custom style loading failed.");

            return StatusCode(
                StatusCodes.Status502BadGateway,
                new
                {
                    code =
                        "tomtom_local_style_read_error",

                    message =
                        ex.Message
                });
        }
    }

    // ============================================================
    // TOMTOM RESOURCE PROXY
    // ============================================================

    [HttpGet("tomtom-proxy")]
    public async Task<IActionResult> TomTomProxy(
        [FromQuery] string url,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(url))
        {
            return BadRequest(
                new
                {
                    code =
                        "missing_url"
                });
        }

        if (
            !Uri.TryCreate(
                url,
                UriKind.Absolute,
                out var targetUri)
        )
        {
            return BadRequest(
                new
                {
                    code =
                        "invalid_url"
                });
        }

        /*
         * SECURITY:
         *
         * Dozvoljen je samo TomTom API host.
         *
         * Ne želimo da ovaj endpoint postane
         * proizvoljni SSRF proxy.
         */
        if (
            !string.Equals(
                targetUri.Host,
                TomTomHost,
                StringComparison.OrdinalIgnoreCase)
        )
        {
            return BadRequest(
                new
                {
                    code =
                        "host_not_allowed"
                });
        }

        if (
            !string.Equals(
                targetUri.Scheme,
                Uri.UriSchemeHttps,
                StringComparison.OrdinalIgnoreCase)
        )
        {
            return BadRequest(
                new
                {
                    code =
                        "scheme_not_allowed"
                });
        }

        var apiKey =
            configuration["TomTom:ApiKey"];

        if (string.IsNullOrWhiteSpace(apiKey))
        {
            return StatusCode(
                StatusCodes.Status503ServiceUnavailable,
                new
                {
                    code =
                        "tomtom_api_key_missing"
                });
        }

        var cleanUri =
            RemoveQueryParameter(
                targetUri,
                "key");

        cleanUri =
            RemoveQueryParameter(
                cleanUri,
                "apiKey");

        try
        {
            var client =
                httpClientFactory
                    .CreateClient(
                        "MapTiles");

            using var request =
                new HttpRequestMessage(
                    HttpMethod.Get,
                    cleanUri);

            /*
             * KEY OSTANE NA SERVERU.
             */
            request.Headers.TryAddWithoutValidation(
                "TomTom-Api-Key",
                apiKey);

            request.Headers.TryAddWithoutValidation(
                "Accept",
                "*/*");

            using var response =
                await client.SendAsync(
                    request,
                    HttpCompletionOption.ResponseHeadersRead,
                    ct);

            if (!response.IsSuccessStatusCode)
            {
                var upstreamBody =
                    await response.Content
                        .ReadAsStringAsync(ct);

                logger.LogWarning(
                    "TomTom proxy resource failed. " +
                    "HTTP {StatusCode}. " +
                    "URL {Url}. " +
                    "Body {Body}",
                    (int)response.StatusCode,
                    cleanUri,
                    upstreamBody);

                return StatusCode(
                    (int)response.StatusCode,
                    new
                    {
                        code =
                            "tomtom_upstream_error",

                        status =
                            (int)response.StatusCode
                    });
            }

            var contentType =
                response.Content.Headers
                    .ContentType?
                    .MediaType;

            if (string.IsNullOrWhiteSpace(
                    contentType))
            {
                contentType =
                    GuessContentType(
                        cleanUri);
            }

            var bytes =
                await response.Content
                    .ReadAsByteArrayAsync(ct);

            if (bytes.Length == 0)
            {
                return StatusCode(
                    StatusCodes.Status502BadGateway,
                    new
                    {
                        code =
                            "tomtom_empty_resource"
                    });
            }

            Response.Headers.CacheControl =
                "public,max-age=300";

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
            logger.LogError(
                ex,
                "TomTom resource proxy failed for {Url}",
                cleanUri);

            return StatusCode(
                StatusCodes.Status502BadGateway,
                new
                {
                    code =
                        "tomtom_resource_proxy_failed",

                    message =
                        ex.Message
                });
        }
    }

    // ============================================================
    // RASTER TILE ENDPOINT
    // ============================================================

    [HttpGet(
        "tiles/{layer}/{zoom:int}/{x:int}/{y:int}.png")]
    public async Task<IActionResult> Tile(
        string layer,
        int zoom,
        int x,
        int y,
        CancellationToken ct)
    {
        layer =
            layer.ToLowerInvariant();

        if (!Layers.Contains(layer))
        {
            return NotFound();
        }

        if (zoom < 0 || zoom > 22)
        {
            return BadRequest(
                "Invalid zoom.");
        }

        var tileCount =
            1L << zoom;

        if (
            y < 0 ||
            y >= tileCount
        )
        {
            return BadRequest(
                "Invalid tile Y coordinate.");
        }

        x =
            NormalizeX(
                x,
                checked(
                    (int)tileCount));

        var apiKey =
            configuration[
                "TomTom:ApiKey"];

        var usesTomTom =
            layer == "dark" ||
            layer == "flow" ||
            layer == "incidents";

        if (
            usesTomTom &&
            string.IsNullOrWhiteSpace(
                apiKey)
        )
        {
            return StatusCode(
                StatusCodes.Status503ServiceUnavailable,
                new
                {
                    code =
                        "map_provider_not_configured",

                    layer
                });
        }

        var cacheKey =
            $"map:{layer}:{zoom}:{x}:{y}";

        if (
            cache.TryGetValue(
                cacheKey,
                out MapTile? cached
            ) &&
            cached is not null
        )
        {
            Response.Headers.CacheControl =
                $"public,max-age={GetCacheSeconds(layer)}";

            return File(
                cached.Bytes,
                cached.ContentType);
        }

        var url =
            BuildRasterUrl(
                layer,
                zoom,
                x,
                y);

        if (url is null)
        {
            return NotFound();
        }

        try
        {
            var client =
                httpClientFactory
                    .CreateClient(
                        "MapTiles");

            using var request =
                new HttpRequestMessage(
                    HttpMethod.Get,
                    url);

            if (
                usesTomTom &&
                !string.IsNullOrWhiteSpace(
                    apiKey)
            )
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

            if (
                string.IsNullOrWhiteSpace(
                    contentType) ||
                !contentType.StartsWith(
                    "image/",
                    StringComparison.OrdinalIgnoreCase)
            )
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
                GetCacheSeconds(
                    layer);

            cache.Set(
                cacheKey,
                tile,
                TimeSpan.FromSeconds(
                    cacheSeconds));

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
                "{Layer} {Zoom}/{X}/{Y}",
                layer,
                zoom,
                x,
                y);

            return StatusCode(
                StatusCodes.Status502BadGateway);
        }
    }

    // ============================================================
    // RASTER URLS
    // ============================================================

    private string? BuildRasterUrl(
        string layer,
        int zoom,
        int x,
        int y)
    {
        var apiKey =
            configuration[
                "TomTom:ApiKey"];

        if (
            layer != "satellite" &&
            string.IsNullOrWhiteSpace(
                apiKey)
        )
        {
            return null;
        }

        var trafficStyle =
            configuration[
                "TomTom:TrafficStyle"];

        trafficStyle =
            string.Equals(
                trafficStyle,
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
                "https://api.tomtom.com/maps/orbis/" +
                "traffic/flow/raster/tile/" +
                $"{zoom}/{x}/{y}" +
                $"?apiVersion=2" +
                $"&style={trafficStyle}" +
                $"&key={escapedKey}",

            "incidents" =>
                "https://api.tomtom.com/maps/orbis/" +
                "traffic/incidents/raster/tile/" +
                $"{zoom}/{x}/{y}" +
                $"?apiVersion=2" +
                $"&style={trafficStyle}" +
                $"&key={escapedKey}",

            "dark" =>
                "https://api.tomtom.com/map/1/tile/" +
                "basic/night/" +
                $"{zoom}/{x}/{y}.png" +
                $"?key={escapedKey}",

            "satellite" =>
                "https://server.arcgisonline.com/" +
                "ArcGIS/rest/services/" +
                "World_Imagery/MapServer/tile/" +
                $"{zoom}/{y}/{x}",

            _ =>
                null
        };
    }

    // ============================================================
    // STYLE RESOURCE REWRITER
    // ============================================================

    private static object? RewriteTomTomResources(
        JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                {
                    var result =
                        new Dictionary<string, object?>(
                            StringComparer.Ordinal);

                    foreach (
                        var property
                        in element.EnumerateObject())
                    {
                        result[property.Name] =
                            RewriteTomTomResources(
                                property.Value);
                    }

                    return result;
                }

            case JsonValueKind.Array:
                {
                    var result =
                        new List<object?>();

                    foreach (
                        var item
                        in element.EnumerateArray())
                    {
                        result.Add(
                            RewriteTomTomResources(
                                item));
                    }

                    return result;
                }

            case JsonValueKind.String:
                {
                    var value =
                        element.GetString();

                    if (
                        string.IsNullOrWhiteSpace(
                            value)
                    )
                    {
                        return value;
                    }

                    /*
                     * Ako local style JSON sadrži direktan
                     * TomTom URL, prebaci ga preko našeg proxy-ja.
                     */
                    if (
                        IsTomTomUrl(value)
                    )
                    {
                        var cleaned =
                            RemoveTomTomApiKey(
                                new Uri(value));

                        return
                            "/api/map/tomtom-proxy?url=" +
                            Uri.EscapeDataString(
                                cleaned.ToString());
                    }

                    return value;
                }

            case JsonValueKind.Number:
                {
                    if (
                        element.TryGetInt64(
                            out var integer)
                    )
                    {
                        return integer;
                    }

                    if (
                        element.TryGetDouble(
                            out var number)
                    )
                    {
                        return number;
                    }

                    return null;
                }

            case JsonValueKind.True:
                return true;

            case JsonValueKind.False:
                return false;

            case JsonValueKind.Null:
                return null;

            default:
                return null;
        }
    }

    private static bool IsTomTomUrl(
        string value)
    {
        if (
            !Uri.TryCreate(
                value,
                UriKind.Absolute,
                out var uri)
        )
        {
            return false;
        }

        return
            uri.Scheme ==
                Uri.UriSchemeHttps
            &&
            uri.Host.Equals(
                TomTomHost,
                StringComparison.OrdinalIgnoreCase);
    }

    private static Uri RemoveTomTomApiKey(
        Uri uri)
    {
        var result =
            RemoveQueryParameter(
                uri,
                "key");

        result =
            RemoveQueryParameter(
                result,
                "apiKey");

        return result;
    }

    // ============================================================
    // QUERY PARAMETER HELPERS
    // ============================================================

    private static Uri RemoveQueryParameter(
        Uri uri,
        string parameterName)
    {
        var builder =
            new UriBuilder(uri);

        var query =
            builder.Query.TrimStart('?');

        if (
            string.IsNullOrWhiteSpace(
                query)
        )
        {
            return uri;
        }

        var parts =
            query.Split(
                '&',
                StringSplitOptions.RemoveEmptyEntries);

        var remaining =
            new List<string>();

        foreach (
            var part
            in parts)
        {
            var separator =
                part.IndexOf('=');

            var name =
                separator >= 0
                    ? part[..separator]
                    : part;

            if (
                string.Equals(
                    Uri.UnescapeDataString(
                        name),
                    parameterName,
                    StringComparison.OrdinalIgnoreCase)
            )
            {
                continue;
            }

            remaining.Add(
                part);
        }

        builder.Query =
            string.Join(
                "&",
                remaining);

        return builder.Uri;
    }

    // ============================================================
    // CONTENT TYPE
    // ============================================================

    private static string GuessContentType(
        Uri uri)
    {
        var path =
            uri.AbsolutePath
                .ToLowerInvariant();

        if (
            path.EndsWith(
                ".json",
                StringComparison.Ordinal)
        )
        {
            return "application/json";
        }

        if (
            path.EndsWith(
                ".pbf",
                StringComparison.Ordinal)
        )
        {
            return "application/x-protobuf";
        }

        if (
            path.EndsWith(
                ".png",
                StringComparison.Ordinal)
        )
        {
            return "image/png";
        }

        if (
            path.EndsWith(
                ".webp",
                StringComparison.Ordinal)
        )
        {
            return "image/webp";
        }

        if (
            path.EndsWith(
                ".jpg",
                StringComparison.Ordinal)
            ||
            path.EndsWith(
                ".jpeg",
                StringComparison.Ordinal)
        )
        {
            return "image/jpeg";
        }

        if (
            path.EndsWith(
                ".svg",
                StringComparison.Ordinal)
        )
        {
            return "image/svg+xml";
        }

        if (
            path.EndsWith(
                ".woff",
                StringComparison.Ordinal)
            ||
            path.EndsWith(
                ".woff2",
                StringComparison.Ordinal)
        )
        {
            return "font/woff";
        }

        return "application/octet-stream";
    }

    // ============================================================
    // CACHE
    // ============================================================

    private static int GetCacheSeconds(
        string layer)
    {
        return layer switch
        {
            "flow" =>
                30,

            "incidents" =>
                15,

            "dark" =>
                3600,

            "satellite" =>
                86400,

            _ =>
                60
        };
    }

    // ============================================================
    // XYZ
    // ============================================================

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

    // ============================================================
    // TILE MODEL
    // ============================================================

    private sealed record MapTile(
        byte[] Bytes,
        string ContentType);
}