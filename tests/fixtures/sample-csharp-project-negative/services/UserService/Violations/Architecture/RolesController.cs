using Microsoft.AspNetCore.Mvc;

namespace UserServiceApp.Violations.Architecture;

/// <summary>Manage user roles.</summary>
[ApiController]
// VIOLATION: architecture/deterministic/action-route-without-controller-route
public class RolesController : ControllerBase
{
    /// <summary>List the available roles.</summary>
    [HttpGet("list")]
    public IActionResult List() => Ok();
}
