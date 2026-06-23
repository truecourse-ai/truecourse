using System;
using System.Collections.Generic;

namespace UserServiceApp.Violations.Performance;

/// <summary>
/// Validates and normalizes user handles / display names. The string checks below
/// each have a cheaper BCL form (Length == 0, char overloads, StringBuilder, span
/// concat, cached SearchValues) but are written the slow way.
/// </summary>
internal sealed class HandleValidator
{
    internal bool IsBlank(string handle)
    {
        // VIOLATION: performance/deterministic/empty-string-compared-with-equals
        // VIOLATION: code-quality/deterministic/compare-to-empty-string
        return handle == "";
    }

    internal bool LooksLikeMention(string handle)
    {
        // VIOLATION: performance/deterministic/prefer-char-overload
        // VIOLATION: performance/deterministic/prefer-char-startswith-endswith
        // VIOLATION: bugs/deterministic/missing-stringcomparison-overload
        return handle.StartsWith("@");
    }

    internal bool HasSeparator(string handle)
    {
        // VIOLATION: performance/deterministic/string-contains-char
        return handle.Contains(".");
    }

    internal bool IsRootPath(string path)
    {
        // VIOLATION: performance/deterministic/startswith-over-indexof-zero
        // VIOLATION: code-quality/deterministic/substring-over-starts-ends
        // VIOLATION: bugs/deterministic/missing-stringcomparison-overload
        return path.IndexOf("/") == 0;
    }

    internal string JoinTags(IReadOnlyList<string> tags)
    {
        var result = string.Empty;
        foreach (var tag in tags)
        {
            // VIOLATION: performance/deterministic/string-concat-in-loop
            // VIOLATION: performance/deterministic/quadratic-list-summation
            // VIOLATION: code-quality/deterministic/prefer-template
            result += "#" + tag + " ";
        }
        return result;
    }

    internal string DomainOf(string email, int atIndex)
    {
        // VIOLATION: performance/deterministic/use-span-string-concat
        return string.Concat("@", email.Substring(atIndex + 1));
    }

    internal int FirstDelimiter(ReadOnlySpan<char> handle)
    {
        // VIOLATION: performance/deterministic/uncached-searchvalues
        return handle.IndexOfAny("@.-_");
    }
}
