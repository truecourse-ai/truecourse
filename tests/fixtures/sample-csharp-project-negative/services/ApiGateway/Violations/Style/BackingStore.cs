namespace ApiGateway.Violations.Style;

/// <summary>Holds state in a member that collides with a C# 14 keyword.</summary>
internal sealed class BackingStore
{
    // VIOLATION: style/deterministic/field-keyword-conflict
    private int field;

    internal void Increment() => field++;

    internal int Current() => field;
}
