namespace ApiGateway.Violations.Bugs;

internal sealed class RetryWindow
{
    private int _attempts;

    internal void Run()
    {
        // VIOLATION: bugs/deterministic/for-condition-never-true
        for (int i = 100; i < 2; i++)
        {
            _attempts += i;
        }
    }

    internal int Attempts => _attempts;
}
