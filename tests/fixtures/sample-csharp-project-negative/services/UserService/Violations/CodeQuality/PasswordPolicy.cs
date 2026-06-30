using System;

namespace UserServiceApp.Violations.CodeQuality;

/// <summary>
/// Enforces password rules and builds policy descriptions. Several helpers here
/// were written with awkward call shapes and unused return values.
/// </summary>
internal sealed class PasswordPolicy
{
    private int _failedAttempts;

    private readonly string _bannerPrefix = "Password policy";

    /// <summary>Runs all checks against a candidate password.</summary>
    public void Evaluate(string password)
    {
        var normalized = Normalize(password);
        Validate(normalized);
        RecordCheck();
    }

    // VIOLATION: code-quality/deterministic/return-value-never-used
    private bool Validate(string password)
    {
        var ok = password.Length >= MinLength;
        if (!ok)
        {
            _failedAttempts++;
        }

        return ok;
    }

    // VIOLATION: code-quality/deterministic/static-method-candidate
    // VIOLATION: code-quality/deterministic/unused-this-parameter
    private string Normalize(string password)
    {
        return password.Trim();
    }

    // VIOLATION: code-quality/deterministic/unused-function-parameter
    /// <summary>Joins the policy requirements into one description.</summary>
    public string Describe(params string[] requirements)
    {
        // VIOLATION: performance/deterministic/constant-array-argument
        // VIOLATION: code-quality/deterministic/array-for-params-argument
        return Join(new[] { "min length 8", "one digit", "one symbol" });
    }

    /// <summary>Returns the lockout window after too many failures.</summary>
    public TimeSpan Lockout()
    {
        // VIOLATION: code-quality/deterministic/default-value-type-constructor
        return new TimeSpan();
    }

    /// <summary>Returns the banner shown on the policy screen.</summary>
    public string Banner()
    {
        // VIOLATION: code-quality/deterministic/boolean-trap
        // VIOLATION: code-quality/deterministic/explicit-default-argument
        return Format(_bannerPrefix, true);
    }

    private string Format(string title, bool uppercase = true)
    {
        return uppercase ? (title + _bannerPrefix).ToUpperInvariant() : title;
    }

    private static string Join(params string[] parts) => string.Join(", ", parts);

    private void RecordCheck() => _failedAttempts++;

    private const int MinLength = 8;
}
