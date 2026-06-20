using Microsoft.AspNetCore.Mvc;

namespace UserServiceApp.Violations.Architecture;

/// <summary>Accept avatar uploads.</summary>
[ApiController]
[Route("api/uploads")]
public class UploadController : ControllerBase
{
    /// <summary>Store a posted avatar.</summary>
    [HttpPost]
    public IActionResult Save()
    {
        // VIOLATION: architecture/deterministic/raw-request-access-in-action
        var caption = Request.Form["caption"].ToString();
        return Ok(caption);
    }
}
