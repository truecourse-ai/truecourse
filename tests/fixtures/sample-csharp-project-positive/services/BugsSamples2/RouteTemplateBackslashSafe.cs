using Microsoft.AspNetCore.Mvc;

namespace Positive.Boundary.Bugs;

/// <summary>Routes internal API calls using forward-slash path segments.</summary>
[ApiController]
// SAFE: bugs/deterministic/route-template-backslash
[Route("api/internal")]
public sealed class RouteTemplateBackslashSafe : ControllerBase
{
    /// <summary>Handles a request for the named method.</summary>
    [HttpGet("handle")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public IActionResult Handle() => Ok();
}
