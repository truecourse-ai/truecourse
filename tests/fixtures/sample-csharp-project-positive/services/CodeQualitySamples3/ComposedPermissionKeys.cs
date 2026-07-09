namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A <c>public const</c> that is referenced inside another constant's
/// initializer must stay <c>const</c> — a <c>static readonly</c> field is not a
/// compile-time constant and cannot appear in a const expression. The
/// public-const-versioning-hazard rule must not suggest converting such a
/// composed-into constant.
/// </summary>
public static class ComposedPermissionKeys
{
    // SAFE: code-quality/deterministic/public-const-versioning-hazard
    // Referenced by the composed constant below, so it must remain `const`.
    public const string GroupName = "billing";

    // Built from GroupName at compile time; kept private so it is not itself a
    // public-surface constant.
    private const string InvoicePaid = GroupName + ".InvoicePaid";

    /// <summary>Returns the fully-qualified invoice-paid permission name.</summary>
    public static string InvoicePaidPermission() => InvoicePaid;
}
