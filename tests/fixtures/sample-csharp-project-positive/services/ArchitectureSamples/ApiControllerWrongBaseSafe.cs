using Microsoft.AspNetCore.Mvc;

namespace Positive.Boundary.Architecture;

/// <summary>Read-only profiles API controller.</summary>
[ApiController]
[Route("api/profiles")]
// SAFE: architecture/deterministic/api-controller-wrong-base
public class ApiControllerWrongBaseSafe : ControllerBase
{
    private static readonly string[] DefaultProfiles = { "default" };

    /// <summary>List the profile identifiers.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(string[]), 200)]
    public IActionResult List() => Ok(DefaultProfiles);
}
