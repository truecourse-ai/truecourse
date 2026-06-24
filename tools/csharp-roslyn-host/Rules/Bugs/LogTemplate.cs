namespace TrueCourse.RoslynHost;

/// <summary>
/// Parsing of a message-template literal's `{placeholder}` tokens, shared by the
/// logging-template rules. Honors `{{` / `}}` escapes and strips alignment/format
/// specifiers (`{Name,10:000}`) and a leading `@`/`$` serialization-operator prefix,
/// returning the bare placeholder name (which may be numeric, e.g. "0").
/// </summary>
internal static class LogTemplate
{
    public static IEnumerable<string> Placeholders(string text)
    {
        for (var i = 0; i < text.Length; i++)
        {
            var ch = text[i];
            if (ch == '{')
            {
                if (i + 1 < text.Length && text[i + 1] == '{') { i++; continue; } // escaped {{
                var end = text.IndexOf('}', i + 1);
                if (end < 0) yield break; // malformed — handled by the braces rule
                var inner = text.Substring(i + 1, end - i - 1);
                var cut = inner.IndexOfAny(new[] { ',', ':' });
                var name = (cut >= 0 ? inner.Substring(0, cut) : inner).Trim();
                if (name.Length > 0 && (name[0] == '@' || name[0] == '$')) name = name.Substring(1);
                yield return name;
                i = end;
            }
            else if (ch == '}' && i + 1 < text.Length && text[i + 1] == '}')
            {
                i++; // escaped }}
            }
        }
    }

    /// <summary>
    /// True if the template has malformed/unbalanced braces: a `{` with no matching
    /// `}`, or a lone unescaped `}`. `{{` and `}}` are escapes and don't count.
    /// </summary>
    public static bool HasUnbalancedBraces(string text)
    {
        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (c is '{' or '}')
            {
                if (i + 1 < text.Length && text[i + 1] == c) { i++; continue; } // escaped {{ or }}
                if (c == '{')
                {
                    var close = text.IndexOf('}', i + 1);
                    if (close < 0) return true; // unterminated placeholder
                    i = close;
                }
                else
                {
                    return true; // a lone '}' with no opening '{'
                }
            }
        }
        return false;
    }
}
