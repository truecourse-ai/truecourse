using Microsoft.AspNetCore.Mvc;

namespace Positive.Boundary.Architecture;

/// <summary>
/// A server-rendered MVC view controller: it derives from <c>Controller</c> and
/// carries no <c>[ApiController]</c>, so its actions return rendered views and
/// never appear in the generated API description. <c>[ProducesResponseType]</c>
/// shapes only that API description, so requiring it here is a false positive —
/// action-missing-producesresponsetype must not fire.
/// </summary>
[Route("catalog")]
public sealed class CatalogPageController : Controller
{
    /// <summary>Renders the catalog landing page.</summary>
    [HttpGet]
    // SAFE: architecture/deterministic/action-missing-producesresponsetype
    public IActionResult Index() => View();
}
