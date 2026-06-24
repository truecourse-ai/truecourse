using Microsoft.AspNetCore.Mvc;

namespace Positive.Boundary.Architecture;

/// <summary>View component that reflects a posted caption; reading the raw request here is normal.</summary>
public sealed class RawRequestAccessInActionSafe : ViewComponent
{
    /// <summary>Renders the caption taken straight off the request form.</summary>
    public IViewComponentResult Invoke()
    {
        // SAFE: architecture/deterministic/raw-request-access-in-action
        var caption = HttpContext.Request.Form["caption"].ToString();
        return View("Default", caption);
    }
}
