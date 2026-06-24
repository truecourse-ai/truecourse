using Microsoft.AspNetCore.Mvc;

namespace UserServiceApp.Violations.Architecture;

/// <summary>Manage user accounts.</summary>
[ApiController]
[Route("api/accounts")]
public class AccountsController : ControllerBase
{
    /// <summary>Fetch one account by id.</summary>
    // VIOLATION: architecture/deterministic/action-missing-http-verb
    public IActionResult Get(int id) => Ok(id);
}
