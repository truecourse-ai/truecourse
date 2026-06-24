using Microsoft.AspNetCore.Mvc;

namespace ApiGateway.Violations.Architecture;

/// <summary>
/// Exposes report endpoints. The action returns data but declares no response
/// types, so the generated API description shows only an untyped 200.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public sealed class ReportsController : ControllerBase
{
    /// <summary>Returns the daily summary report.</summary>
    [HttpGet("daily")]
    // VIOLATION: architecture/deterministic/action-missing-producesresponsetype
    public IActionResult Daily() => Ok();
}
