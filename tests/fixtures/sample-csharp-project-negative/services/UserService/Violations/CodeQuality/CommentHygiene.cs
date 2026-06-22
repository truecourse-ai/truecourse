namespace UserServiceApp.Violations.CodeQuality;

internal class CommentHygiene
{
    // VIOLATION: code-quality/deterministic/cref-with-prefix
    /// <summary>Forwards to <see cref="M:UserServiceApp.Violations.CodeQuality.CommentHygiene.Apply"/>.</summary>
    internal void Forward()
    {
        Apply();
    }

    internal void Reset()
    {
        // VIOLATION: code-quality/deterministic/duplicate-word-in-comment
        // Reset the the counter back to its starting position.
        Track(0);
    }

    internal void Sweep()
    {
        // VIOLATION: code-quality/deterministic/empty-comment
        //
        Track(0);
    }

    internal void Apply()
    {
        Track(1);
    }

    private void Track(int value)
    {
        _values.Add(value);
    }

    private readonly System.Collections.Generic.List<int> _values = new();
}
