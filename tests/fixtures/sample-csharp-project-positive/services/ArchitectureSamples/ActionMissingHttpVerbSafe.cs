using Microsoft.AspNetCore.Mvc;

namespace Positive.Boundary.Architecture;

/// <summary>Returns widget summaries.</summary>
[ApiController]
[Route("api/widgets")]
public sealed class ActionMissingHttpVerbSafe : ControllerBase
{
    /// <summary>Lists the available widgets.</summary>
    // SAFE: architecture/deterministic/action-missing-http-verb
    [HttpGet]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public IActionResult List() => Ok();
}
