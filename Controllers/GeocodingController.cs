using Microsoft.AspNetCore.Mvc;
using ProMapCargo.Api.Services;

namespace ProMapCargo.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class GeocodingController : ControllerBase
{
    private readonly IGeocodingService _service;

    public GeocodingController(IGeocodingService service)
    {
        _service = service;
    }

    [HttpGet]
    public async Task<IActionResult> Search(
        [FromQuery] string? q,
        [FromQuery(Name = "query")] string? query,
        [FromQuery] int limit = 6,
        CancellationToken ct = default)
    {
        var text = !string.IsNullOrWhiteSpace(q) ? q : query;

        if (string.IsNullOrWhiteSpace(text) || text.Trim().Length < 2)
        {
            return BadRequest(new
            {
                message = "Parametar q/query mora imati najmanje 2 karaktera."
            });
        }

        var results = await _service.SearchAsync(
            text.Trim(),
            Math.Clamp(limit, 1, 10),
            ct);

        return Ok(new
        {
            query = text.Trim(),
            count = results.Count,
            results
        });
    }
}