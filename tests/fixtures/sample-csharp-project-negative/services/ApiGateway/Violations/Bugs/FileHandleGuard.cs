namespace ApiGateway.Violations.Bugs;

internal sealed class FileHandleGuard
{
    private readonly string _path;

    internal FileHandleGuard(string path) => _path = path;

    ~FileHandleGuard()
    {
        // VIOLATION: bugs/deterministic/finalizer-throws
        // VIOLATION: bugs/deterministic/exception-from-unexpected-member
        throw new InvalidOperationException(_path);
    }
}
