namespace UserService.Violations.Bugs;

/// <summary>Stores a configured weight.</summary>
internal sealed class SelfAssignedField
{
    /// <summary>The configured weight.</summary>
    internal int Weight { get; set; }

    /// <summary>Re-applies the weight, but assigns the property to itself — a
    /// no-op that has no effect (a missed assignment from another source).</summary>
    internal void Reapply()
    {
        // VIOLATION: bugs/deterministic/self-assignment
        Weight = Weight;
    }
}
