namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A nullable value type declared with the idiomatic <c>T?</c> shorthand
/// rather than the long-form <c>Nullable&lt;T&gt;</c>, so the rule must not
/// fire.
/// </summary>
public class NullableShorthandSafe
{
    // SAFE: code-quality/deterministic/nullable-shorthand
    internal int? RetryBudget { get; set; }
}
