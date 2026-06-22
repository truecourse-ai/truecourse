using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// `this` passed as an argument to a method or object construction from inside a
/// constructor body. The receiving code gets a reference to a partially-initialized
/// instance (fields after the call site, and subclass fields, are still default).
/// Needs symbol resolution to confirm the call escapes to a method that is not the
/// type's own private helper.
/// </summary>
internal sealed class ThisEscapesConstructor : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/this-escapes-constructor";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var ctor in tree.GetRoot().DescendantNodes().OfType<ConstructorDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(ctor) is not IMethodSymbol ctorSym) continue;
            var owner = ctorSym.ContainingType;
            var body = (SyntaxNode?)ctor.Body ?? ctor.ExpressionBody;
            if (body is null || owner is null) continue;

            foreach (var arg in body.DescendantNodes().OfType<ArgumentSyntax>())
            {
                if (arg.Expression is not ThisExpressionSyntax) continue;

                // The argument must belong to a method/constructor call (not, e.g., an
                // indexer of `this` itself). Walk up to the nearest invocation/creation.
                var call = arg.FirstAncestorOrSelf<SyntaxNode>(n =>
                    n is InvocationExpressionSyntax or ObjectCreationExpressionSyntax);
                if (call is null) continue;

                var target = model.GetSymbolInfo(call).Symbol as IMethodSymbol;

                // Suppress escapes into the type's OWN private instance helpers — those
                // stay inside the class and are an accepted initialization pattern.
                if (target is { DeclaredAccessibility: Accessibility.Private } &&
                    SymbolEqualityComparer.Default.Equals(target.ContainingType, owner) &&
                    target.MethodKind == MethodKind.Ordinary)
                    continue;

                var pos = arg.GetLocation().GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    "'this' is passed to external code from a constructor, exposing a partially-initialized instance.");
            }
        }
    }
}
