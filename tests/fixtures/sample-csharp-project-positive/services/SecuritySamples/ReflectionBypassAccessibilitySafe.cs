using System.Reflection;

namespace Positive.Boundary.Security;

/// <summary>Inspects binding flags by comparison only, without using them to reach hidden members.</summary>
public sealed class ReflectionBypassAccessibilitySafe
{
    /// <summary>Reports whether the supplied flags request non-public member access.</summary>
    internal bool RequestsNonPublic(BindingFlags flags)
    {
        // SAFE: security/deterministic/reflection-bypass-accessibility
        return flags == BindingFlags.NonPublic;
    }
}
