using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A by-value parameter whose very first use is a plain reassignment, so the value
/// the caller passed is thrown away before it is ever read — almost always a logic
/// slip (a wrong variable, or a default that should have been a fallback). The
/// semantic model resolves the parameter and orders its references; the rule fires
/// only when the first reference is the left side of a simple <c>=</c> whose
/// right-hand side does not read the parameter, so genuine fallbacks like
/// <c>s = s ?? ""</c> or <c>x = x + 1</c> (which use the incoming value) are never
/// flagged. <c>ref</c>/<c>out</c>/<c>in</c> parameters are excluded.
/// </summary>
internal sealed class InitialValueOverwritten : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/initial-value-overwritten";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var method in tree.GetRoot().DescendantNodes().OfType<MethodDeclarationSyntax>())
        {
            SyntaxNode? body = (SyntaxNode?)method.Body ?? method.ExpressionBody;
            if (body is null) continue;

            foreach (var param in method.ParameterList.Parameters)
            {
                if (param.Modifiers.Any(m => m.IsKind(SyntaxKind.RefKeyword) || m.IsKind(SyntaxKind.OutKeyword) || m.IsKind(SyntaxKind.InKeyword)))
                    continue;
                if (model.GetDeclaredSymbol(param) is not IParameterSymbol sym) continue;

                var refs = body.DescendantNodes().OfType<IdentifierNameSyntax>()
                    .Where(id => SymbolEqualityComparer.Default.Equals(model.GetSymbolInfo(id).Symbol, sym))
                    .OrderBy(id => id.SpanStart)
                    .ToList();
                if (refs.Count == 0) continue;

                var first = refs[0];
                if (first.Parent is not AssignmentExpressionSyntax assign) continue;
                if (!assign.IsKind(SyntaxKind.SimpleAssignmentExpression) || assign.Left != first) continue;
                // If the right-hand side reads the parameter, the incoming value IS used.
                if (refs.Skip(1).Any(r => assign.Right.Span.Contains(r.Span))) continue;

                var pos = param.Identifier.GetLocation().GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"Parameter '{sym.Name}' is overwritten before it is read — the caller's value is discarded.");
            }
        }
    }
}
