using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// `ArgumentNullException.ThrowIfNull(x)` (or ThrowIfNullOrEmpty/ThrowIfNullOrWhiteSpace
/// for the null part) called with an argument that can never be null: a `new`
/// expression, a `nameof(...)`, a non-nullable value type, or a literal. The guard
/// is dead code. Needs the argument's resolved type/expression kind. CA2264.
/// </summary>
internal sealed class ThrowIfNullNeverNullArgument : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/throwifnull-never-null-argument";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (inv.Expression is not MemberAccessExpressionSyntax ma) continue;
            if (ma.Name.Identifier.Text != "ThrowIfNull") continue;
            if (inv.ArgumentList.Arguments.Count < 1) continue;

            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) continue;
            if (m.Name != "ThrowIfNull" ||
                m.ContainingType is not { Name: "ArgumentNullException", ContainingNamespace.Name: "System" })
                continue;

            var arg = inv.ArgumentList.Arguments[0].Expression;
            var reason = NeverNullReason(arg, model);
            if (reason is null) continue;

            var pos = inv.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"ArgumentNullException.ThrowIfNull is passed {reason}, which can never be null — the guard is dead code.");
        }
    }

    private static string? NeverNullReason(ExpressionSyntax expr, SemanticModel model)
    {
        var e = expr;
        while (e is ParenthesizedExpressionSyntax p) e = p.Expression;

        switch (e)
        {
            case ObjectCreationExpressionSyntax:
            case ImplicitObjectCreationExpressionSyntax:
            case ArrayCreationExpressionSyntax:
            case ImplicitArrayCreationExpressionSyntax:
                return "a freshly-constructed object";
            case AnonymousObjectCreationExpressionSyntax:
                return "an anonymous object";
            case InvocationExpressionSyntax { Expression: IdentifierNameSyntax { Identifier.Text: "nameof" } }:
                return "the result of nameof(...)";
            case LiteralExpressionSyntax lit when !lit.IsKind(SyntaxKind.NullLiteralExpression)
                                                  && !lit.IsKind(SyntaxKind.DefaultLiteralExpression):
                return "a literal value";
        }

        // A non-nullable value type can never be null (Nullable<T> can).
        var type = model.GetTypeInfo(expr).Type;
        if (type is { IsValueType: true } && type.OriginalDefinition.SpecialType != SpecialType.System_Nullable_T)
            return $"a non-nullable value type ('{type.Name}')";

        return null;
    }
}
