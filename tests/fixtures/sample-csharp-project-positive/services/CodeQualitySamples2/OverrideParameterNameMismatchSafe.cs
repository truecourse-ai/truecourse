namespace Positive.Boundary.CodeQuality;

/// <summary>Base store whose overridable member fixes the parameter names.</summary>
public abstract class OverrideParameterNameMismatchSafeBase
{
    /// <summary>Stores a payload under the given key.</summary>
    public abstract void Store(string key, object payload);
}

/// <summary>
/// An override that keeps the base declaration's parameter names exactly
/// (<c>key</c>, <c>payload</c>), so named-argument callers stay correct and the
/// rule must not fire.
/// </summary>
public sealed class OverrideParameterNameMismatchSafe : OverrideParameterNameMismatchSafeBase
{
    private object? _last;

    /// <summary>Stores the payload, retaining it for later inspection.</summary>
    // SAFE: code-quality/deterministic/override-parameter-name-mismatch
    public override void Store(string key, object payload)
    {
        _last = key.Length > 0 ? payload : null;
    }

    /// <summary>Returns the most recently stored payload.</summary>
    public object? Last() => _last;
}
