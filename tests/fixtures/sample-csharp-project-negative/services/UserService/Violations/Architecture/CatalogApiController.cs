using Microsoft.AspNetCore.Mvc;

namespace UserServiceApp.Violations.Architecture;

/// <summary>Serves catalog data over HTTP as a JSON API.</summary>
[ApiController]
[Route("api/catalog")]
public sealed class CatalogApiController : ControllerBase
{
    /// <summary>Returns all catalog entries.</summary>
    [HttpGet]
    // VIOLATION: architecture/deterministic/action-missing-producesresponsetype
    public IActionResult List() => Ok();
}
