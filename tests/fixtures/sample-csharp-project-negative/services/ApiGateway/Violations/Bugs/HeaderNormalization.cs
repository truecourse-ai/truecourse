using System;

namespace ApiGateway.Violations.Bugs;

// Normalizes and compares request header values. Every string operation here uses
// a culture-sensitive overload and parses numbers without a format provider, so the
// behaviour silently changes with the server's locale.
internal sealed class HeaderNormalization
{
    internal string CanonicalName(string raw)
    {
        // Culture-dependent casing, and lowercasing is the wrong direction for a
        // canonical key (upper-invariant round-trips, lower does not for some scripts).
        // VIOLATION: bugs/deterministic/culture-unaware-string-operation
        // VIOLATION: bugs/deterministic/normalize-to-lower-not-upper
        return raw.ToLower();
    }

    internal string CanonicalToken(string raw)
    {
        // ToLowerInvariant avoids the culture trap but still normalizes to lower.
        // VIOLATION: bugs/deterministic/normalize-to-lower-not-upper
        return raw.ToLowerInvariant();
    }

    internal int OrderHeaders(string a, string b)
    {
        // Static string.Compare without a StringComparison is culture-sensitive.
        // VIOLATION: bugs/deterministic/culture-unaware-string-operation
        // VIOLATION: bugs/deterministic/missing-stringcomparison-overload
        return string.Compare(a, b);
    }

    internal bool SameValue(string a, string b)
    {
        // Instance Equals without a StringComparison defaults to ordinal, but the
        // analyzer wants the comparison made explicit at the call site.
        // VIOLATION: bugs/deterministic/missing-stringcomparison-overload
        return a.Equals(b);
    }

    internal bool IsBearer(string authorization)
    {
        // StartsWith(string) without a StringComparison is culture-sensitive.
        // VIOLATION: bugs/deterministic/missing-stringcomparison-overload
        return authorization.StartsWith("Bearer ");
    }

    internal int ContentLength(string headerValue)
    {
        // int.Parse without an IFormatProvider uses the current culture's number format.
        // VIOLATION: bugs/deterministic/missing-format-provider-overload
        return int.Parse(headerValue);
    }

    internal string FormatLatency(double seconds)
    {
        // double.ToString() without a provider is culture-dependent.
        // VIOLATION: bugs/deterministic/missing-format-provider-overload
        return seconds.ToString();
    }
}
