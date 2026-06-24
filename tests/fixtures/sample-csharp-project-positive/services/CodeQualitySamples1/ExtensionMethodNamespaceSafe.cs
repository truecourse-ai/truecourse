namespace Positive.Boundary.CodeQuality;

using Positive.Boundary.CodeQuality.Model;

/// <summary>Extends a type that lives in a different namespace, so consumers can opt out.</summary>
public static class ExtensionMethodNamespaceSafe
{
    // SAFE: code-quality/deterministic/extension-method-namespace
    /// <summary>Masks the handle value.</summary>
    public static string Mask(this UserHandle handle)
    {
        return handle.Value.Length <= 2 ? "**" : handle.Value[..2] + "***";
    }
}
