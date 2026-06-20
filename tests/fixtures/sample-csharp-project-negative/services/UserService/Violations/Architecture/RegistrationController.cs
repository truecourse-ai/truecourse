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
    public IActionResult Create(RegistrationInput model)
    {
        return RedirectToAction("Index", model);
    }
}
