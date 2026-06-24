using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// An optional parameter on an externally visible method or constructor. Default
/// values are baked into each call site at compile time, so changing the default in a
/// later version silently leaves old callers on the old value; optional parameters
/// also interact confusingly with overload resolution across assembly boundaries. We
/// resolve the declaring method's effective accessibility and flag only public /
/// protected surface, leaving private helpers — where the hazard does not apply —
/// alone.
/// </summary>
internal sealed class OptionalParameterHazard : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/optional-parameter-hazard";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var node in tree.GetRoot().DescendantNodes().OfType<BaseMethodDeclarationSyntax>())
        {
            if (node is not (MethodDeclarationSyntax or ConstructorDeclarationSyntax)) continue;
            if (model.GetDeclaredSymbol(node) is not IMethodSymbol method) continue;

            // Only externally visible members carry the cross-assembly versioning hazard.
            if (!IsExternallyVisible(method)) continue;
            // Overrides/interface implementations must keep the base signature — the
            // defaults are dictated elsewhere, so flagging here is not actionable.
            if (method.IsOverride || method.ExplicitInterfaceImplementations.Length > 0) continue;

            foreach (var p in node.ParameterList.Parameters)
            {
                if (p.Default is null) continue;
                var pos = p.Identifier.GetLocation().GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"Optional parameter '{p.Identifier.ValueText}' bakes its default into call sites and complicates versioning; prefer overloads on a public API.");
            }
        }
    }

    private static bool IsExternallyVisible(IMethodSymbol method)
    {
        if (method.DeclaredAccessibility is not (Accessibility.Public or Accessibility.Protected
            or Accessibility.ProtectedOrInternal))
            return false;
        // Every enclosing type must also be externally visible for the surface to escape.
        for (var t = method.ContainingType; t is not null; t = t.ContainingType)
            if (t.DeclaredAccessibility is not (Accessibility.Public or Accessibility.Protected
                or Accessibility.ProtectedOrInternal))
                return false;
        return true;
    }
}
