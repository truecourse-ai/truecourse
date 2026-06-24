using Microsoft.AspNetCore.Mvc;

namespace Positive.Boundary.Security;

/// <summary>Serves files from a fixed directory after stripping path segments from user input.</summary>
public sealed class UserInputInPathSafe : Controller
{
    private const string Root = "data";

    /// <summary>Reads a file whose name is reduced to its leaf component before use.</summary>
    [HttpGet]
    public IActionResult Download(string fileName)
    {
        // SAFE: security/deterministic/user-input-in-path
        string contents = System.IO.File.ReadAllText(System.IO.Path.Combine(Root, System.IO.Path.GetFileName(fileName)));
        return Content(contents);
    }
}
