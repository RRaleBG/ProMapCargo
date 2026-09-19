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
    ILogger<MapTilesController> logger) : ControllerBase
{
    private const string DefaultCustomStyleUrl =
        "https://api.tomtom.com/style/2/custom/style/" +
        "dG9tdG9tQEBANndOMmY2c2hkWEdNUTh2dDvHAUOO8wBB8Y5JhgFOxC6O/" +
        "drafts/0";

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
    // CONFIG
    // ============================================================

    [HttpGet("config")]
    public IActionResult Config()
    {
        var hasTomTomKey =
            !string.IsNullOrWhiteSpace(
                configuration["TomTom:ApiKey"]);

        var customStyleUrl =
            configuration["TomTom:CustomStyleUrl"];

        if (string.IsNullOrWhiteSpace(customStyleUrl))
        {
            customStyleUrl =
                DefaultCustomStyleUrl;
        }

        return Ok(new
        {
            defaultBase =
                hasTomTomKey
                    ? "dark"
                    : "osm",

            customStyleUrl =
                hasTomTomKey
                    ? "/api/map/tomtom/style"
                    : null,

            customStyleConfigured =
                hasTomTomKey,

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

    // ============================================================
    // CUSTOM TOMTOM STYLE
    // ============================================================

    [HttpGet("tomtom/style")]
    public async Task<IActionResult> TomTomStyle(
        CancellationToken ct)
    {
        var apiKey =
            configuration["TomTom:ApiKey"];

        if (string.IsNullOrWhiteSpace(apiKey))
        {
            return StatusCode(
                StatusCodes.Status503ServiceUnavailable,
                new
                {
                    code =
                        "map_provider_not_configured"
                });
        }

        var configuredStyleUrl =
            configuration[
                "TomTom:CustomStyleUrl"];

        var styleUrl =
            string.IsNullOrWhiteSpace(
                configuredStyleUrl)
                ? DefaultCustomStyleUrl
                : configuredStyleUrl;

        if (!TryBuildTomTomUri(
                styleUrl,
                out var uri,
                out var error))
        {
            return BadRequest(error);
        }

        try
        {
            var client =
                httpClientFactory
                    .CreateClient("MapTiles");

            using var request =
                new HttpRequestMessage(
                    HttpMethod.Get,
                    RemoveQueryParameter(
                        uri,
                        "key"));

            /*
             * API key ostaje isključivo na backendu.
             */
            request.Headers.TryAddWithoutValidation(
                "TomTom-Api-Key",
                apiKey);

            request.Headers.TryAddWithoutValidation(
                "Accept",
                "application/json");

            using var response =
                await client.SendAsync(
                    request,
                    HttpCompletionOption.ResponseHeadersRead,
                    ct);

            var body =
                await response.Content
                    .ReadAsStringAsync(ct);

            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning(
                    "TomTom custom style failed. " +
                    "HTTP {StatusCode}. URL: {Url}",
                    (int)response.StatusCode,
                    uri);

                return StatusCode(
                    (int)response.StatusCode,
                    body);
            }

            /*
             * Veoma bitno:
             *
             * Style JSON može sadržati:
             *
             * - sources
             * - sprite
             * - glyphs
             * - tile URL-ove
             *
             * Njih prepisujemo na naš server-side proxy.
             */
            string rewrittenStyle;

            try
            {
                using var document =
                    JsonDocument.Parse(body);

                var rewritten =
                    RewriteTomTomResources(
                        document.RootElement);

                rewrittenStyle =
                    JsonSerializer.Serialize(
                        rewritten,
                        new JsonSerializerOptions
                        {
                            WriteIndented = false
                        });
            }
            catch (JsonException ex)
            {
                logger.LogWarning(
                    ex,
                    "TomTom returned invalid style JSON.");

                return StatusCode(
                    StatusCodes.Status502BadGateway,
                    new
                    {
                        code =
                            "invalid_tomtom_style_json"
                    });
            }

            Response.ContentType =
                "application/json; charset=utf-8";

            Response.Headers.CacheControl =
                "public,max-age=300";

            return Content(
                rewrittenStyle,
                "application/json");
        }
        catch (
            OperationCanceledException
        )
            when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger.LogWarning(
                ex,
                "TomTom custom style proxy failed.");

            return StatusCode(
                StatusCodes.Status502BadGateway,
                new
                {
                    code =
                        "tomtom_style_proxy_failed",
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
                "Missing url.");
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
                        "map_provider_not_configured"
                });
        }

        if (!TryBuildTomTomUri(
                url,
                out var uri,
                out var error))
        {
            return BadRequest(error);
        }

        try
        {
            var client =
                httpClientFactory
                    .CreateClient("MapTiles");

            var cleanUri =
                RemoveQueryParameter(
                    uri,
                    "key");

            using var request =
                new HttpRequestMessage(
                    HttpMethod.Get,
                    cleanUri);

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
                logger.LogWarning(
                    "TomTom proxy resource failed. " +
                    "HTTP {StatusCode}, URL: {Url}",
                    (int)response.StatusCode,
                    cleanUri);

                return StatusCode(
                    (int)response.StatusCode);
            }

            var contentType =
                response.Content.Headers
                    .ContentType?
                    .ToString();

            if (string.IsNullOrWhiteSpace(
                    contentType))
            {
                contentType =
                    "application/octet-stream";
            }

            var bytes =
                await response.Content
                    .ReadAsByteArrayAsync(ct);

            if (bytes.Length == 0)
            {
                return StatusCode(
                    StatusCodes.Status502BadGateway);
            }

            Response.Headers.CacheControl =
                "public,max-age=300";

            return File(
                bytes,
                contentType);
        }
        catch (
            OperationCanceledException
        )
            when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger.LogWarning(
                ex,
                "TomTom resource proxy failed: {Url}",
                uri);

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
    // REWRITE STYLE JSON
    // ============================================================

    private object? RewriteTomTomResources(
        JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                {
                    var dictionary =
                        new Dictionary<string, object?>(
                            StringComparer.Ordinal);

                    foreach (
                        var property
                        in element.EnumerateObject())
                    {
                        dictionary[property.Name] =
                            RewriteTomTomResources(
                                property.Value);
                    }

                    return dictionary;
                }

            case JsonValueKind.Array:
                {
                    var list =
                        new List<object?>();

                    foreach (
                        var item
                        in element.EnumerateArray())
                    {
                        list.Add(
                            RewriteTomTomResources(
                                item));
                    }

                    return list;
                }

            case JsonValueKind.String:
                {
                    var value =
                        element.GetString();

                    if (
                        !string.IsNullOrWhiteSpace(
                            value) &&
                        IsTomTomUrl(value))
                    {
                        return BuildProxyUrl(
                            value);
                    }

                    return value;
                }

            case JsonValueKind.Number:
                if (element.TryGetInt64(
                        out var longValue))
                {
                    return longValue;
                }

                if (element.TryGetDouble(
                        out var doubleValue))
                {
                    return doubleValue;
                }

                return null;

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
        if (!Uri.TryCreate(
                value,
                UriKind.Absolute,
                out var uri))
        {
            return false;
        }

        return
            uri.Scheme == Uri.UriSchemeHttps &&
            uri.Host.Equals(
                TomTomHost,
                StringComparison.OrdinalIgnoreCase);
    }

    private static string BuildProxyUrl(
        string value)
    {
        return
            "/api/map/tomtom-proxy?url=" +
            Uri.EscapeDataString(
                RemoveQueryParameter(
                    new Uri(value),
                    "key").ToString());
    }

    // ============================================================
    // RASTER TILE ENDPOINT
    // ============================================================

    [HttpGet(
        "tiles/{layer}/{zoom:int}/{x:int}/{y:int}.png"
    )]
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
                    (int)tileCount
                ));

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
            BuildUrl(
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
        catch (
            OperationCanceledException
        )
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

    // ============================================================
    // RASTER PROVIDER URL
    // ============================================================

    private string? BuildUrl(
        string layer,
        int zoom,
        int x,
        int y)
    {
        var apiKey =
            configuration[
                "TomTom:ApiKey"];

        if (
            string.IsNullOrWhiteSpace(
                apiKey) &&
            layer != "satellite"
        )
        {
            return null;
        }

        var style =
            configuration[
                "TomTom:TrafficStyle"
            ] ?? "dark";

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
                "https://api.tomtom.com/maps/orbis/" +
                "traffic/flow/raster/tile/" +
                $"{zoom}/{x}/{y}" +
                $"?apiVersion=2&style={style}&key={escapedKey}",

            "incidents" =>
                "https://api.tomtom.com/maps/orbis/" +
                "traffic/incidents/raster/tile/" +
                $"{zoom}/{x}/{y}" +
                $"?apiVersion=2&style={style}&key={escapedKey}",

            "dark" =>
                "https://api.tomtom.com/map/1/tile/basic/night/" +
                $"{zoom}/{x}/{y}.png?key={escapedKey}",

            "satellite" =>
                "https://server.arcgisonline.com/ArcGIS/rest/services/" +
                $"World_Imagery/MapServer/tile/{zoom}/{y}/{x}",

            _ =>
                null
        };
    }

    // ============================================================
    // URL SECURITY
    // ============================================================

    private static bool TryBuildTomTomUri(
        string value,
        out Uri uri,
        out string error)
    {
        uri =
            null!;

        error =
            "";

        if (
            !Uri.TryCreate(
                value,
                UriKind.Absolute,
                out var parsed)
        )
        {
            error =
                "Invalid TomTom URL.";

            return false;
        }

        if (
            parsed.Scheme !=
            Uri.UriSchemeHttps
        )
        {
            error =
                "Only HTTPS URLs are allowed.";

            return false;
        }

        if (
            !parsed.Host.Equals(
                TomTomHost,
                StringComparison.OrdinalIgnoreCase)
        )
        {
            error =
                "TomTom proxy target is not allowed.";

            return false;
        }

        uri =
            parsed;

        return true;
    }

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

        var filtered =
            parts
                .Where(
                    part =>
                        !part.StartsWith(
                            parameterName + "=",
                            StringComparison.OrdinalIgnoreCase))
                .ToArray();

        builder.Query =
            string.Join(
                "&",
                filtered);

        return builder.Uri;
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