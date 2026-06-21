using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// An `[Obsolete]` attribute applied without a message argument. The message is the
/// only place to tell callers what to use instead; an empty `[Obsolete]` leaves them
/// guessing. Needs the resolved attribute type to confirm it is
/// System.ObsoleteAttribute (rather than a same-named user attribute). S1123.
/// </summary>
internal sealed class ObsoleteWithoutExplanation : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/obsolete-without-explanation";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var attr in tree.GetRoot().DescendantNodes().OfType<AttributeSyntax>())
        {
            if (model.GetSymbolInfo(attr).Symbol is not IMethodSymbol ctor) continue;
            if (ctor.ContainingType?.ToDisplayString() != "System.ObsoleteAttribute") continue;

            // The message is the first positional argument. Treat a missing first arg,
            // or an explicitly empty/whitespace string literal, as "no explanation".
            if (HasMessage(attr)) continue;

            var pos = attr.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                "[Obsolete] is applied without a message; add an explanation telling callers what to use instead.");
        }
    }

    private static bool HasMessage(AttributeSyntax attr)
    {
        var args = attr.ArgumentList?.Arguments;
        if (args is null || args.Value.Count == 0) return false;

        // First POSITIONAL argument is the message (named args like IsError don't count).
        var first = args.Value[0];
        if (first.NameEquals is not null || first.NameColon is not null) return false;

        // A literal empty/whitespace string is no better than no message.
        if (first.Expression is LiteralExpressionSyntax lit
            && lit.IsKind(Microsoft.CodeAnalysis.CSharp.SyntaxKind.StringLiteralExpression)
            && string.IsNullOrWhiteSpace(lit.Token.ValueText))
            return false;

        return true;
    }
}
