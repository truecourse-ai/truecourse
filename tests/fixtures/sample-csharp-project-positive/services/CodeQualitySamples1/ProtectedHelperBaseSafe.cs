namespace Positive.Boundary.CodeQuality;

/// <summary>
/// An inheritance base that hands <c>protected static</c> helpers to its
/// subclasses. A <c>static</c> class is sealed and abstract — C# forbids protected
/// members on it and it cannot be subclassed — and marking the type <c>sealed</c>
/// would likewise break its subclasses. So neither no-extraneous-class nor
/// static-holder-type-not-sealed may fire on a type exposing protected members.
/// </summary>
public class ProtectedHelperBaseSafe
{
    // SAFE: code-quality/deterministic/no-extraneous-class
    // SAFE: code-quality/deterministic/static-holder-type-not-sealed
    protected static bool HasPayload(object context)
    {
        return context != null;
    }

    protected static object GetPayload(object context)
    {
        return HasPayload(context) ? context : null;
    }
}
