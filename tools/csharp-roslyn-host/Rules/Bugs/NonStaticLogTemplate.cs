using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// The message-template argument to a Microsoft.Extensions.Logging logging call
/// (ILogger.Log / LoggerExtensions.LogXxx) is not a compile-time-constant string —
/// it is built with string concatenation or interpolation. A non-constant template
/// defeats structured logging: every call produces a distinct template, log
/// aggregation can't group by message, and the interpolated values are baked into
/// the rendered text instead of captured as named properties (and pay the format
/// cost even when the level is disabled). Bound through the semantic model to confirm
/// the call really is an ILogger/LoggerExtensions logging method and to locate the
/// template parameter precisely. S2629 / CA2254.
/// </summary>
internal sealed class NonStaticLogTemplate : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/non-static-log-template";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (inv.Expression is not MemberAccessExpressionSyntax ma) continue;
            if (!LoggingMethods.IsLogMethodName(ma.Name.Identifier.ValueText)) continue;

            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol method) continue;
            if (!LoggingMethods.IsLoggerType(method.ContainingType)) continue;

            var template = LoggingMethods.FindTemplateArgument(inv, method);
            if (template is null) continue;

            // A plain string literal is the well-behaved case — nothing to flag.
            if (template.IsKind(SyntaxKind.StringLiteralExpression)) continue;

            // Anything the compiler can fold to a constant string (e.g. literal +
            // literal, or a const field) is still a static template — allow it.
            var constant = model.GetConstantValue(template);
            if (constant.HasValue && constant.Value is string) continue;

            // Only concatenation / interpolation are the recognized non-static
            // template shapes; bail on anything else (a variable, a method call)
            // to stay false-positive free — those are separate concerns.
            string? shape = template switch
            {
                InterpolatedStringExpressionSyntax => "an interpolated string",
                BinaryExpressionSyntax b when b.IsKind(SyntaxKind.AddExpression)
                    && InvolvesString(model, b) => "string concatenation",
                _ => null,
            };
            if (shape is null) continue;

            var pos = template.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Log message template is built with {shape} — pass a constant template with named " +
                "{Placeholders} and the values as arguments so structured logging can capture them.");
        }
    }

    // A '+' is only a string concatenation if at least one side is a string; an
    // int + int next to a log call (rare, but possible via overloads) is not a template.
    private static bool InvolvesString(SemanticModel model, BinaryExpressionSyntax b)
    {
        var l = model.GetTypeInfo(b.Left).Type;
        var r = model.GetTypeInfo(b.Right).Type;
        return l?.SpecialType == SpecialType.System_String || r?.SpecialType == SpecialType.System_String;
    }
}
