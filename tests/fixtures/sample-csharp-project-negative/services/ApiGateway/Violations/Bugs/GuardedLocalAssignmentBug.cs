namespace ApiGateway.Violations.Bugs;

/// <summary>
/// Guards an assignment to a plain local with the same value it already holds.
/// Unlike a guarded write to an observable entity property (whose setter can drive
/// change-tracking), a local assignment has no side effect, so the `!=` guard is a
/// genuine no-op and check-against-value-being-assigned must still fire.
/// </summary>
internal sealed class GuardedLocalAssignmentBug
{
    internal int Clamp(int value, int seed)
    {
        int result = seed;
        // VIOLATION: bugs/deterministic/check-against-value-being-assigned
        if (result != value)
        {
            result = value;
        }

        return result;
    }
}
