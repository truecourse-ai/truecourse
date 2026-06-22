using System;

namespace UserServiceApp.Violations.CodeQuality;

/// <summary>
/// Static helpers and constants for account handling, plus a small marker
/// attribute. The visibility and sealing modifiers here were never tidied up.
/// </summary>
// VIOLATION: code-quality/deterministic/no-extraneous-class
// VIOLATION: code-quality/deterministic/static-holder-type-not-sealed
internal class AccountDefaults
{
    // VIOLATION: code-quality/deterministic/public-const-versioning-hazard
    public const int FreeSeatLimit = 3;

    /// <summary>Lower-cases and trims an email for canonical storage.</summary>
    public static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();
}

internal class PlanCatalog
{
    // VIOLATION: code-quality/deterministic/member-more-visible-than-type
    // VIOLATION: code-quality/deterministic/non-private-field
    public string DefaultPlanId = "starter";

    // VIOLATION: code-quality/deterministic/missing-access-modifier
    // VIOLATION: code-quality/deterministic/unused-private-method
    string ResolvePlanName(string planId) => planId == DefaultPlanId ? "Starter" : "Custom";
}

// VIOLATION: code-quality/deterministic/attribute-missing-usage
// VIOLATION: code-quality/deterministic/unsealed-attribute
// VIOLATION: code-quality/deterministic/non-abstract-attribute-not-sealed
internal class FeatureFlagAttribute : Attribute
{
    public FeatureFlagAttribute(string flag)
    {
        Flag = flag;
    }

    public string Flag { get; }
}
