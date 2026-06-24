// SAFE: code-quality/deterministic/empty-namespace-declaration
namespace Positive.Boundary.CodeQuality
{
    /// <summary>
    /// A block-form namespace declaration is only flagged when it declares no
    /// types. This one holds a real type, so the empty-namespace rule must not
    /// fire.
    /// </summary>
    public class EmptyNamespaceDeclarationSafe
    {
        /// <summary>The configured retry count.</summary>
        public int RetryCount { get; set; }
    }
}
