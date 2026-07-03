using Microsoft.AspNetCore.Mvc;

namespace UserService.Violations.Architecture;

/// <summary>A controller that is documented in the API but omits response metadata.</summary>
[ApiController]
[ApiExplorerSettings(GroupName = "v1")]
public sealed class GroupedReportController : ControllerBase
{
    // [ApiExplorerSettings] is present but IgnoreApi is not set, so the action is
    // still part of the API description; declaring no [ProducesResponseType] leaves
    // its response shape and status codes missing from the OpenAPI document.
    // VIOLATION: architecture/deterministic/action-missing-producesresponsetype
    [HttpGet]
    public IActionResult List() => Ok();
}
