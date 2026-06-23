using Microsoft.AspNetCore.Mvc;

namespace Positive.Boundary.Architecture;

/// <summary>Returns gadget summaries.</summary>
[ApiController]
[Route("api/gadgets")]
public sealed class ActionMissingProducesResponseTypeSafe : ControllerBase
{
    /// <summary>Lists the available gadgets.</summary>
    [HttpGet]
    // SAFE: architecture/deterministic/action-missing-producesresponsetype
    [ProducesResponseType(StatusCodes.Status200OK)]
    public IActionResult List() => Ok();
}
