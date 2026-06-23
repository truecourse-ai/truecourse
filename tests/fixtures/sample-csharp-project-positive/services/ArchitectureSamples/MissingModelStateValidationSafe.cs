using Microsoft.AspNetCore.Mvc;

namespace Positive.Boundary.Architecture;

/// <summary>Input for a profile update.</summary>
internal sealed class ProfileInput
{
    /// <summary>The chosen display name.</summary>
    public string DisplayName { get; set; } = string.Empty;
}

/// <summary>MVC controller that validates ModelState before acting on a bound model.</summary>
[Route("profile")]
public class MissingModelStateValidationSafe : Controller
{
    /// <summary>Update the profile from the posted form after checking the model.</summary>
    [HttpPost]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    public IActionResult Update(ProfileInput model)
    {
        // SAFE: architecture/deterministic/missing-modelstate-validation
        if (!ModelState.IsValid)
        {
            return BadRequest(ModelState);
        }

        return Ok(model.DisplayName);
    }
}
