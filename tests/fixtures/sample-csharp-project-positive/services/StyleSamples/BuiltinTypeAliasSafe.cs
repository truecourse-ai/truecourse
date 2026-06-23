namespace Positive.Boundary.Style;

internal sealed class BuiltinTypeAliasSafe
{
    private int _sequence;

    // SAFE: style/deterministic/builtin-type-alias
    internal string FrameworkName => nameof(Int32);

    internal int NextSequence() => ++_sequence;
}
