using System.Text.RegularExpressions;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A composite-format call (string.Format / StringBuilder.AppendFormat / Console.Write[Line])
/// whose format string is a LITERAL references an argument index outside the supplied range,
/// or supplies arguments that no placeholder uses — both cause a FormatException or silently
/// dropped data. To stay free of false positives we only analyze calls where the format is a
/// string literal and the arguments are passed individually (not via an `object[]` / params
/// spread), and we resolve the bound method to find the format/args split. We need the
/// semantic model to identify the format-parameter position and rule out a spread array.
/// </summary>
internal sealed class FormatStringPlaceholderMismatch : ISemanticRule
{
    private static readonly Regex Placeholder = new(@"\{\{|\}\}|\{(\d+)(?:,-?\d+)?(?::[^}]*)?\}", RegexOptions.Compiled);

    public string RuleKey => "bugs/deterministic/format-string-placeholder-mismatch";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) continue;
            if (!IsCompositeFormat(m)) continue;

            // Find the (string format) parameter position; an IFormatProvider may precede it.
            var formatIdx = FormatParamIndex(m);
            if (formatIdx < 0) continue;

            var args = inv.ArgumentList.Arguments;
            if (formatIdx >= args.Count) continue;

            // Format must be a plain string literal so we can read the placeholders.
            if (args[formatIdx].Expression is not LiteralExpressionSyntax lit ||
                lit.Token.Value is not string format)
                continue;

            var argCount = args.Count - (formatIdx + 1);
            if (argCount < 0) continue;

            // If the single remaining argument is an array (params spread or explicit object[]),
            // we can't count elements statically — bail to avoid false positives.
            if (argCount == 1)
            {
                var t = model.GetTypeInfo(args[formatIdx + 1].Expression).Type;
                if (t is IArrayTypeSymbol) continue;
            }

            var indices = new HashSet<int>();
            int maxIndex = -1;
            bool malformed = false;
            foreach (Match match in Placeholder.Matches(format))
            {
                if (!match.Groups[1].Success) continue; // escaped {{ or }}
                var idx = int.Parse(match.Groups[1].Value);
                indices.Add(idx);
                if (idx > maxIndex) maxIndex = idx;
            }

            // Any lone unescaped brace is itself a malformed template.
            malformed = HasUnbalancedBraces(format);

            if (malformed)
            {
                yield return Report(inv, tree, "the format string has unbalanced or unescaped braces");
                continue;
            }
            if (maxIndex < 0) continue; // no placeholders → nothing to validate here

            if (maxIndex >= argCount)
            {
                yield return Report(inv, tree,
                    $"placeholder {{{maxIndex}}} has no matching argument (only {argCount} supplied) — this throws FormatException at runtime");
            }
        }
    }

    private static bool IsCompositeFormat(IMethodSymbol m)
    {
        switch (m.Name)
        {
            case "Format" when m.ContainingType?.SpecialType == SpecialType.System_String && m.IsStatic:
            case "AppendFormat" when m.ContainingType?.Name == "StringBuilder":
                return true;
            case "Write" or "WriteLine" when m.ContainingType?.Name == "Console" && m.IsStatic:
                // Only the composite-format overload (first/second param is a format string with extra args).
                return m.Parameters.Length >= 2 && m.Parameters.Any(p => p.Type.SpecialType == SpecialType.System_String);
            default:
                return false;
        }
    }

    private static int FormatParamIndex(IMethodSymbol m)
    {
        for (var i = 0; i < m.Parameters.Length; i++)
            if (m.Parameters[i].Type.SpecialType == SpecialType.System_String &&
                m.Parameters[i].Name is "format" or "value")
                return i;
        // Fallback: first string parameter.
        for (var i = 0; i < m.Parameters.Length; i++)
            if (m.Parameters[i].Type.SpecialType == SpecialType.System_String) return i;
        return -1;
    }

    private static bool HasUnbalancedBraces(string s)
    {
        for (var i = 0; i < s.Length; i++)
        {
            char c = s[i];
            if (c is '{' or '}')
            {
                if (i + 1 < s.Length && s[i + 1] == c) { i++; continue; } // escaped {{ or }}
                if (c == '{')
                {
                    int close = s.IndexOf('}', i + 1);
                    if (close < 0) return true;
                    i = close;
                }
                else
                {
                    return true; // a lone '}' with no matching '{'
                }
            }
        }
        return false;
    }

    private Violation Report(InvocationExpressionSyntax inv, SyntaxTree tree, string detail)
    {
        var pos = inv.GetLocation().GetLineSpan().StartLinePosition;
        return new Violation(RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
            $"Composite format string mismatch — {detail}.");
    }
}
