using Microsoft.AspNetCore.Mvc;

namespace Positive.Boundary.Architecture;

/// <summary>Returns invoice summaries.</summary>
[ApiController]
[Route("api/invoices")]
public sealed class ActionRouteLeadingSlashSafe : ControllerBase
{
    /// <summary>Lists invoices for the period.</summary>
    // SAFE: architecture/deterministic/action-route-leading-slash
    [HttpGet("recent")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public IActionResult ListRecent() => Ok();
}
