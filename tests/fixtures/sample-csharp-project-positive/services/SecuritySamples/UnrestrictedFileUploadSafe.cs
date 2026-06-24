using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Positive.Boundary.Security;

/// <summary>Accepts an avatar upload with an explicit, bounded request-size limit.</summary>
[ApiController]
public sealed class UnrestrictedFileUploadSafe : ControllerBase
{
    private const int MaxUploadBytes = 1048576;

    /// <summary>Stores the uploaded avatar after the framework enforces the size cap.</summary>
    [RequestSizeLimit(MaxUploadBytes)]
    [HttpPost]
    [ProducesResponseType(200)]
    // SAFE: security/deterministic/unrestricted-file-upload
    internal IActionResult Upload(IFormFile file)
    {
        return Ok(file.FileName);
    }
}
