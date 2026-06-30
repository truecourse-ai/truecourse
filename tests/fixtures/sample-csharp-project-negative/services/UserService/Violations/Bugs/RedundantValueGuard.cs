namespace UserServiceApp.Violations.Bugs;

/// <summary>Applies an incoming level, guarding a plain field with a redundant check.</summary>
internal sealed class RedundantValueGuard
{
    private int _level;

    /// <summary>Stores the incoming level.</summary>
    internal void Apply(int incoming)
    {
        // Guarding a plain FIELD assignment with `!=` is genuinely redundant: a
        // field has no observable setter, so assigning unconditionally has the
        // identical effect. This is the real bug the rule must keep catching.
        // VIOLATION: bugs/deterministic/check-against-value-being-assigned
        if (_level != incoming)
        {
            _level = incoming;
        }
    }
}
