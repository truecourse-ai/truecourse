using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A namespace declaration that contains no type definitions (only nested namespaces,
/// usings, or nothing). An empty namespace is dead structure — it declares an
/// organizing unit that organizes nothing. We confirm there is no declared type
/// member anywhere beneath the block so a namespace that only wraps a sub-namespace
/// holding types is not flagged. S3261.
/// </summary>
internal sealed class EmptyNamespace : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/empty-namespace";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var ns in tree.GetRoot().DescendantNodes().OfType<BaseNamespaceDeclarationSyntax>())
        {
            // File-scoped namespaces span the rest of the file; a file with a file-scoped
            // namespace but no types is unusual but still empty. Block-scoped namespaces
            // are the common shape. Both expose Members.
            if (ns.Members.OfType<BaseTypeDeclarationSyntax>().Any()) continue;
            if (ns.Members.OfType<DelegateDeclarationSyntax>().Any()) continue;

            // If a nested namespace declared inside this one ultimately holds types, the
            // outer namespace is a meaningful grouping — don't flag it.
            if (ns.Members.OfType<BaseNamespaceDeclarationSyntax>()
                .Any(child => child.DescendantNodes().Any(n => n is BaseTypeDeclarationSyntax or DelegateDeclarationSyntax)))
                continue;

            var pos = ns.Name.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Namespace '{ns.Name}' contains no type definitions; remove the empty namespace.");
        }
    }
}
