using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// An extension method whose receiver type lives in the SAME namespace as the
/// extension class. Because the namespace is imported for the receiver type itself,
/// the consumer can never opt out of the extension — it is always in scope. Needs
/// the resolved `this` parameter type and both namespaces.
/// </summary>
internal sealed class ExtensionMethodNamespace : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/extension-method-namespace";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var method in tree.GetRoot().DescendantNodes().OfType<MethodDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(method) is not IMethodSymbol sym) continue;
            if (!sym.IsExtensionMethod) continue;
            if (sym.Parameters.Length == 0) continue;

            var receiver = sym.Parameters[0].Type;
            // Only meaningful for named types we can attribute to a namespace; skip
            // primitives/special types and type parameters.
            if (receiver is not INamedTypeSymbol named) continue;
            if (named.SpecialType != SpecialType.None) continue;

            var extNs = sym.ContainingNamespace;
            var recvNs = named.ContainingNamespace;
            if (extNs is null || recvNs is null) continue;
            if (extNs.IsGlobalNamespace || recvNs.IsGlobalNamespace) continue;
            if (!SymbolEqualityComparer.Default.Equals(extNs, recvNs)) continue;

            // Placing an extension in the same namespace as its receiver is the *documented*
            // .NET convention when that namespace is framework-owned — e.g. DI/builder
            // extensions declared in Microsoft.Extensions.DependencyInjection so they are
            // always in scope wherever that namespace is imported. Always-in-scope is the
            // intent there, not a defect. Only flag app-owned namespaces, where a consumer
            // opting out of the extension is a real concern.
            if (IsFrameworkNamespace(extNs)) continue;

            var pos = method.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Extension method '{sym.Name}' is in the same namespace ('{extNs.ToDisplayString()}') as the type it extends ('{named.Name}'), so consumers cannot opt out of it.");
        }
    }

    // A framework-owned namespace (rooted at Microsoft or System). Extension methods
    // are deliberately co-located with framework types there for discoverability, so
    // the "cannot opt out" concern does not apply.
    private static bool IsFrameworkNamespace(INamespaceSymbol ns)
    {
        var current = ns;
        while (current.ContainingNamespace is { IsGlobalNamespace: false } parent)
            current = parent;
        return current.Name is "Microsoft" or "System";
    }
}
