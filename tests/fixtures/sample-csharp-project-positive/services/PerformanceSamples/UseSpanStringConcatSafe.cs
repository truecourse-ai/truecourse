using System;

namespace Positive.Boundary.Performance;

/// <summary>Builds a fully-qualified domain string from an email address.</summary>
public sealed class UseSpanStringConcatSafe
{
    /// <summary>Concatenates a span slice instead of an allocating Substring argument.</summary>
    internal string DomainOf(string email, int atIndex)
    {
        // SAFE: performance/deterministic/use-span-string-concat
        return string.Concat("@".AsSpan(), email.AsSpan(atIndex + 1));
    }
}
