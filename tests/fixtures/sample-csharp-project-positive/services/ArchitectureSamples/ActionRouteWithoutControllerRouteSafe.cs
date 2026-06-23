using Microsoft.AspNetCore.Mvc;

namespace Positive.Boundary.Architecture;

/// <summary>Returns ledger summaries.</summary>
[ApiController]
// SAFE: architecture/deterministic/action-route-without-controller-route
[Route("api/ledgers")]
public sealed class ActionRouteWithoutControllerRouteSafe : ControllerBase
{
    /// <summary>Lists ledger entries.</summary>
    [HttpGet("entries")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public IActionResult ListEntries() => Ok();
}
