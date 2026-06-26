using Microsoft.AspNetCore.Mvc;

namespace Positive.Boundary.Architecture;

/// <summary>
/// A controller excluded from API exploration via
/// <c>[ApiExplorerSettings(IgnoreApi = true)]</c>. It never appears in the
/// generated OpenAPI description, so <c>[ProducesResponseType]</c> would have no
/// effect and must not be required of its actions.
/// </summary>
[ApiController]
[ApiExplorerSettings(IgnoreApi = true)]
public sealed class IgnoredApiController : ControllerBase
{
    /// <summary>Infrastructure endpoint that is hidden from the API description.</summary>
    // SAFE: architecture/deterministic/action-missing-producesresponsetype
    [HttpGet]
    public IActionResult Ping() => Ok();
}
