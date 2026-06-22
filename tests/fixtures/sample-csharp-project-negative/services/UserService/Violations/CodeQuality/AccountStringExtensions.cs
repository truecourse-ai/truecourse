namespace UserServiceApp.Violations.CodeQuality
{
    /// <summary>
    /// String helpers used across the user service. The extension method lives in
    /// the same namespace as the type it extends, so consumers can never opt out of
    /// it.
    /// </summary>
    internal static class AccountStringExtensions
    {
        // VIOLATION: code-quality/deterministic/extension-method-namespace
        public static string Mask(this UserHandle handle)
        {
            return handle.Value.Length <= 2 ? "**" : handle.Value[..2] + "***";
        }
    }

    internal sealed class UserHandle
    {
        public UserHandle(string value)
        {
            Value = value;
        }

        public string Value { get; }
    }
}

// VIOLATION: code-quality/deterministic/empty-namespace-declaration
// VIOLATION: code-quality/deterministic/empty-namespace
namespace UserServiceApp.Violations.CodeQuality.Reserved
{
}
