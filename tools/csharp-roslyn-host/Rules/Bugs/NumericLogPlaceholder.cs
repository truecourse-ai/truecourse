using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A Microsoft.Extensions.Logging message template uses numeric placeholders
/// (`{0}`, `{1}`) instead of named ones (`{UserId}`). The logging pipeline treats
/// the placeholder name as the captured property key, so numeric placeholders
/// produce meaningless property names ("0", "1") and read like a String.Format
/// call that the author mistook for one — the values are still captured, just
/// unusable for structured queries. Bound through the semantic model to confirm
/// the call is an ILogger/LoggerExtensions logging method. CA2253.
/// </summary>
internal sealed class NumericLogPlaceholder : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/numeric-log-placeholder";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (inv.Expression is not MemberAccessExpressionSyntax ma) continue;
            if (!LoggingMethods.IsLogMethodName(ma.Name.Identifier.ValueText)) continue;

            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol method) continue;
            if (!LoggingMethods.IsLoggerType(method.ContainingType)) continue;

            var template = LoggingMethods.FindTemplateArgument(inv, method);
            if (template is not LiteralExpressionSyntax lit
                || !lit.IsKind(SyntaxKind.StringLiteralExpression))
                continue;

            var text = lit.Token.ValueText;
            foreach (var name in LogTemplate.Placeholders(text))
            {
                if (name.Length == 0 || !IsAllDigits(name)) continue;

                var pos = lit.GetLocation().GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"Log template uses the numeric placeholder '{{{name}}}' — name it (e.g. '{{Value}}') so the " +
                    "logged value is captured under a meaningful property rather than the index.");
                break; // one violation per call is enough
            }
        }
    }

    private static bool IsAllDigits(string s) => s.All(char.IsDigit);
}
