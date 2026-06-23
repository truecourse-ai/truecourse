namespace Positive.Boundary.CodeQuality;

/// <summary>Declares a private nested type that the outer class instantiates.</summary>
public sealed class UnusedPrivateNestedClassSafe
{
    /// <summary>Returns the stored label from a freshly built entry.</summary>
    public string Describe(string label)
    {
        var entry = new Entry(label);
        return entry.Label;
    }

    // SAFE: code-quality/deterministic/unused-private-nested-class
    private sealed class Entry
    {
        internal Entry(string label)
        {
            Label = label;
        }

        internal string Label { get; }
    }
}
