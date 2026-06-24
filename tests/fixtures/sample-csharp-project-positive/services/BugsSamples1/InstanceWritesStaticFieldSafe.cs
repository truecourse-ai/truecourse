namespace Positive.Boundary.Bugs;

/// <summary>Tracks per-instance retry counts alongside a shared default budget.</summary>
public sealed class InstanceWritesStaticFieldSafe
{
    private const int DefaultBudget = 3;

    private int _remaining = DefaultBudget;

    /// <summary>Consumes one retry from this instance's own budget.</summary>
    internal void Consume()
    {
        // SAFE: bugs/deterministic/instance-writes-static-field
        _remaining -= 1;
    }

    /// <summary>Reports the retries still available for this instance.</summary>
    internal int Remaining()
    {
        return _remaining;
    }
}
