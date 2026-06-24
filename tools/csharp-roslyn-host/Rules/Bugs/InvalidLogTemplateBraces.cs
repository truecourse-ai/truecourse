using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A Microsoft.Extensions.Logging message-template literal has malformed braces —
/// an unterminated `{` placeholder or a lone unescaped `}`. The logging formatter
/// throws (or silently mis-renders) at runtime: a partially-typed template like
/// "User {UserId logged in" never captures the property and can throw FormatException
/// when the message is materialized. Bound through the semantic model to confirm the
/// call is an ILogger/LoggerExtensions logging method so we only inspect real templates.
/// </summary>
internal sealed class InvalidLogTemplateBraces : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/invalid-log-template-braces";

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

            if (!LogTemplate.HasUnbalancedBraces(lit.Token.ValueText)) continue;

            var pos = lit.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                "Log message template has unbalanced braces — every '{' needs a matching '}' (use '{{' / '}}' " +
                "for a literal brace); the formatter throws FormatException otherwise.");
        }
    }
}
