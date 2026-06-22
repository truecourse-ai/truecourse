namespace ApiGateway.Violations.Bugs;

internal sealed class FlushScheduler
{
    private readonly bool _enabled;

    internal FlushScheduler(bool enabled) => _enabled = enabled;

    internal Task FlushAsync()
    {
        if (_enabled)
        {
            return Task.CompletedTask;
        }

        // VIOLATION: bugs/deterministic/return-null-task
        return null;
    }
}
