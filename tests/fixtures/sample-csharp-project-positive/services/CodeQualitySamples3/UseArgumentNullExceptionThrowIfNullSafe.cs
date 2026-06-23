namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A null guard that already calls <c>ArgumentNullException.ThrowIfNull</c>
/// instead of restating it as <c>if (arg == null) throw new ArgumentNullException(...)</c>.
/// The rule only flags the manual guard whose thrown type is
/// <c>ArgumentNullException</c>, so the helper form must not fire.
/// </summary>
public sealed class UseArgumentNullExceptionThrowIfNullSafe
{
    /// <summary>Validates the request is present and returns its description.</summary>
    public string Validate(object request)
    {
        // SAFE: code-quality/deterministic/use-argumentnullexception-throwifnull
        ArgumentNullException.ThrowIfNull(request);
        return request.GetType().Name;
    }
}
