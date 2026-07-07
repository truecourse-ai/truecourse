namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A public method whose only optional parameter is a CancellationToken defaulting
/// to `default` (CancellationToken.None) — the universal async-cancellation idiom.
/// The default is an immutable, well-known value, so there is no cross-version
/// call-site-baking hazard and the rule must not fire.
/// </summary>
public class OptionalParameterCancellationTokenSafe
{
    // SAFE: code-quality/deterministic/optional-parameter-hazard
    public void Cancel(System.Threading.CancellationToken token = default)
    {
        token.ThrowIfCancellationRequested();
    }
}
