using Microsoft.AspNetCore.Mvc;

namespace UserServiceApp.Violations.Architecture;

/// <summary>Input for user registration.</summary>
internal sealed class RegistrationInput
{
    /// <summary>The chosen display name.</summary>
    public string DisplayName { get; set; } = string.Empty;
}

/// <summary>Handle MVC registration form posts.</summary>
[Route("register")]
public class RegistrationController : Controller
{
    /// <summary>Create an account from the posted form.</summary>
    [HttpPost]
    // VIOLATION: architecture/deterministic/missing-modelstate-validation
    // A server-rendered MVC view controller (base `Controller`, no [ApiController])
    // is not part of the API description, so action-missing-producesresponsetype
    // intentionally does not fire here.
    public IActionResult Create(RegistrationInput model)
    {
        return RedirectToAction("Index", model);
    }
}
