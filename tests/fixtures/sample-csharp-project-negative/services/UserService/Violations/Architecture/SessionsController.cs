using Microsoft.AspNetCore.Mvc;

namespace UserServiceApp.Violations.Architecture;

/// <summary>Manage user sessions.</summary>
[ApiController]
[Route("api/sessions")]
public class SessionsController : ControllerBase
{
    /// <summary>Legacy sign-out kept at the old absolute path.</summary>
    [HttpPost]
    // VIOLATION: architecture/deterministic/action-route-leading-slash
    [Route("/signout")]
    public IActionResult SignOut() => Ok();
}
