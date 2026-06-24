using System.IO;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A static field that is given its value with an inline initializer rather
/// than being assigned in an explicit static constructor, so the type can be
/// marked <c>beforefieldinit</c> and the rule must not fire (CA1810).
/// </summary>
public class StaticFieldInitializeInlineSafe
{
    // SAFE: code-quality/deterministic/static-field-initialize-inline
    private static readonly string ConfigRoot = Path.Combine("/etc", "service");

    internal string Root() => ConfigRoot;
}
