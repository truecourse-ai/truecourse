using System.Text;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A structured-logging call (Microsoft.Extensions.Logging ILogger.Log*) whose
/// message-template literal contains a named placeholder that is not PascalCase, e.g.
/// `"User {userId} signed in"`. Structured-logging conventions (and the analyzers
/// CA1727 / S6678) expect PascalCase property names so the captured fields are
/// consistent. Needs symbol resolution to confirm the call is an ILogger logging
/// method and to find the message-template argument. S6678 / CA1727.
/// </summary>
internal sealed class LogPlaceholderNotPascalCase : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/log-placeholder-not-pascalcase";

    private static readonly HashSet<string> LogMethods = new(StringComparer.Ordinal)
    {
        "Log", "LogTrace", "LogDebug", "LogInformation",
        "LogWarning", "LogError", "LogCritical",
        "BeginScope",
    };

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (inv.Expression is not MemberAccessExpressionSyntax ma) continue;
            if (!LogMethods.Contains(ma.Name.Identifier.ValueText)) continue;

            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol method) continue;
            if (!IsLoggerType(method.ContainingType)) continue;

            // Find the string-literal message template argument (the parameter named
            // "message"/"messageFormat", else the first string literal).
            var template = FindTemplateLiteral(inv, method);
            if (template is null) continue;

            var text = template.Token.ValueText;
            foreach (var (name, offset) in ExtractPlaceholders(text))
            {
                if (IsPascalCase(name)) continue;
                var pos = template.GetLocation().GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"Log placeholder '{{{name}}}' should be PascalCase (e.g. '{{{ToPascal(name)}}}') for consistent structured logging.");
            }
        }
    }

    private static bool IsLoggerType(INamedTypeSymbol? type)
    {
        if (type is null) return false;
        // ILogger / ILogger<T> live in Microsoft.Extensions.Logging; the static
        // LoggerExtensions class hosts the LogXxx extension methods.
        var ns = type.ContainingNamespace?.ToDisplayString();
        if (ns != "Microsoft.Extensions.Logging") return false;
        return type.Name is "ILogger" or "LoggerExtensions";
    }

    private static LiteralExpressionSyntax? FindTemplateLiteral(InvocationExpressionSyntax inv, IMethodSymbol method)
    {
        var args = inv.ArgumentList.Arguments;
        for (var i = 0; i < args.Count; i++)
        {
            if (args[i].Expression is LiteralExpressionSyntax lit
                && lit.IsKind(SyntaxKind.StringLiteralExpression))
                return lit;
        }
        return null;
    }

    /// Extract `{name}` placeholder names, honoring `{{`/`}}` escapes and ignoring
    /// alignment/format specifiers (`{name,10:000}`) and positional indices (`{0}`).
    private static IEnumerable<(string name, int offset)> ExtractPlaceholders(string text)
    {
        for (var i = 0; i < text.Length; i++)
        {
            var ch = text[i];
            if (ch == '{')
            {
                if (i + 1 < text.Length && text[i + 1] == '{') { i++; continue; } // escaped {{
                var end = text.IndexOf('}', i + 1);
                if (end < 0) yield break;
                var inner = text.Substring(i + 1, end - i - 1);
                // strip alignment/format: take up to first ',' or ':'
                var cut = inner.IndexOfAny(new[] { ',', ':' });
                var name = (cut >= 0 ? inner.Substring(0, cut) : inner).Trim();
                // a leading '@' or '$' is a serialization-operator prefix in Serilog-style
                // templates; strip it before judging the name.
                if (name.Length > 0 && (name[0] == '@' || name[0] == '$')) name = name.Substring(1);
                if (name.Length > 0 && !IsAllDigits(name) && IsIdentifier(name))
                    yield return (name, i);
                i = end;
            }
            else if (ch == '}' && i + 1 < text.Length && text[i + 1] == '}')
            {
                i++; // escaped }}
            }
        }
    }

    private static bool IsAllDigits(string s) => s.All(char.IsDigit);

    private static bool IsIdentifier(string s)
    {
        if (!(char.IsLetter(s[0]) || s[0] == '_')) return false;
        return s.All(c => char.IsLetterOrDigit(c) || c == '_');
    }

    private static bool IsPascalCase(string s)
    {
        if (s.Length == 0) return false;
        if (!char.IsUpper(s[0])) return false;
        // Reject underscores — PascalCase has none.
        return !s.Contains('_');
    }

    private static string ToPascal(string s)
    {
        var parts = s.Split('_', StringSplitOptions.RemoveEmptyEntries);
        var sb = new StringBuilder();
        foreach (var p in parts)
            sb.Append(char.ToUpperInvariant(p[0])).Append(p.AsSpan(1));
        return sb.Length == 0 ? s : sb.ToString();
    }
}
