using Microsoft.AspNetCore.Mvc;

namespace UserServiceApp.Violations.Architecture;

/// <summary>Read user profiles.</summary>
[ApiController]
[Route("api/profiles")]
// VIOLATION: architecture/deterministic/api-controller-wrong-base
public class ProfilesController : Controller
{
    /// <summary>List all profiles.</summary>
    [HttpGet]
    // VIOLATION: architecture/deterministic/action-missing-producesresponsetype
    public IActionResult List() => Ok();
}
