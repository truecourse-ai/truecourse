using System.IO;

namespace ApiGateway.Violations.Security;

internal sealed class FileSystemAccess
{
    internal void RelaxPermissions(string path)
    {
        // VIOLATION: security/deterministic/file-permissions-world-accessible
        File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.OtherWrite);
    }

    internal void WriteCache(string contents)
    {
        // VIOLATION: security/deterministic/publicly-writable-directory
        File.WriteAllText("/tmp/gateway-cache.dat", contents);
    }
}
