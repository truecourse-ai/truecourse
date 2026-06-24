using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A constructor invokes a virtual/abstract member declared on its own (non-sealed)
/// type. The most-derived override runs before that derived constructor has
/// initialized its state, so the override observes default fields. Needs symbol
/// resolution to know the invoked member is virtual and self-typed.
/// </summary>
internal sealed class ConstructorCallsVirtualMethod : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/constructor-calls-virtual-method";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var ctor in tree.GetRoot().DescendantNodes().OfType<ConstructorDeclarationSyntax>())
        {
            if (ctor.Body is null && ctor.ExpressionBody is null) continue;
            if (model.GetDeclaredSymbol(ctor) is not IMethodSymbol ctorSym) continue;
            var type = ctorSym.ContainingType;
            // A sealed class has no derived overrides, so the hazard cannot arise.
            if (type is null || type.IsSealed) continue;

            var body = (SyntaxNode?)ctor.Body ?? ctor.ExpressionBody;
            if (body is null) continue;

            foreach (var inv in body.DescendantNodes().OfType<InvocationExpressionSyntax>())
            {
                // Only unqualified or `this.`-qualified calls dispatch virtually on the
                // instance under construction; `base.M()` and `other.M()` do not.
                if (inv.Expression is MemberAccessExpressionSyntax ma &&
                    ma.Expression is not ThisExpressionSyntax)
                    continue;

                if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) continue;
                if (!(m.IsVirtual || m.IsAbstract || m.IsOverride)) continue;
                if (m.IsSealed) continue;
                if (!SymbolEqualityComparer.Default.Equals(m.ContainingType, type)) continue;

                var pos = inv.GetLocation().GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"Constructor calls virtual member '{m.Name}'; a derived override runs before the subclass constructor initializes its fields.");
            }
        }
    }
}
