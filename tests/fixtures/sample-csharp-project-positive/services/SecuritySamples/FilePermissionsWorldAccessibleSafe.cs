using System.IO;

namespace Positive.Boundary.Security;

/// <summary>Applies owner-only permissions plus world-read to a generated file.</summary>
public sealed class FilePermissionsWorldAccessibleSafe
{
    /// <summary>Restricts the file so only the owner may write it.</summary>
    internal void RestrictPermissions(string path)
    {
        // SAFE: security/deterministic/file-permissions-world-accessible
        File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.GroupRead | UnixFileMode.OtherRead);
    }
}
