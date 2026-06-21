using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A type that declares both a property `Foo` and a method `GetFoo()` (or property
/// `GetFoo` and method `Foo` — the `Get`-prefixed pair). Callers cannot tell which one
/// exposes the value, and the redundancy signals one should be removed. This is a true
/// name collision, not a "method should be a property" heuristic: both members must
/// actually exist. We require the method to be parameterless so it is a genuine
/// accessor counterpart. CA1721.
/// </summary>
internal sealed class PropertyMatchesGetMethod : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/property-matches-get-method";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var typeDecl in tree.GetRoot().DescendantNodes().OfType<TypeDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(typeDecl) is not INamedTypeSymbol type) continue;

            var properties = new HashSet<string>(
                type.GetMembers().OfType<IPropertySymbol>()
                    .Where(p => !p.IsIndexer && p.CanBeReferencedByName)
                    .Select(p => p.Name),
                StringComparer.Ordinal);
            if (properties.Count == 0) continue;

            foreach (var method in type.GetMembers().OfType<IMethodSymbol>())
            {
                if (method.MethodKind != MethodKind.Ordinary) continue;
                if (method.Parameters.Length != 0) continue;
                if (!method.Name.StartsWith("Get", StringComparison.Ordinal)) continue;
                if (method.Name.Length <= 3) continue;

                var bare = method.Name.Substring(3);
                // `GetFoo()` collides with a property `Foo` (or, symmetrically, the type
                // has both `GetFoo` method and `GetFoo` property — caught via `properties`).
                var collides = properties.Contains(bare);
                if (!collides) continue;

                var node = method.DeclaringSyntaxReferences
                    .Select(r => r.GetSyntax())
                    .OfType<MethodDeclarationSyntax>()
                    .FirstOrDefault(n => n.SyntaxTree == tree);
                if (node is null) continue;

                var pos = node.Identifier.GetLocation().GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"Method '{method.Name}' collides with property '{bare}' on '{type.Name}'; the pair confuses which exposes the value — keep one.");
            }
        }
    }
}
