using System;
using System.Collections.Generic;

namespace UserServiceApp.Violations.CodeQuality;

/// <summary>
/// The mutable view-model bound to the account-settings screen. Several of its
/// members expose collections and accessors in shapes that leak invariants.
/// </summary>
internal sealed class UserProfile
{
    // VIOLATION: code-quality/deterministic/writable-collection-property
    public List<string> Roles { get; set; } = new();

    // VIOLATION: code-quality/deterministic/unread-private-attribute
    private string _passwordHash = string.Empty;

    // VIOLATION: code-quality/deterministic/accessor-pairs
    // VIOLATION: code-quality/deterministic/write-only-property
    public string PasswordHash
    {
        set => _passwordHash = value;
    }

    public string DisplayName { get; set; } = string.Empty;

    // VIOLATION: code-quality/deterministic/property-name-matches-get-method
    // VIOLATION: code-quality/deterministic/property-matches-get-method
    public string GetDisplayName() => DisplayName;

    // VIOLATION: code-quality/deterministic/identifier-contains-type-name
    public string String { get; set; } = string.Empty;

    private readonly Dictionary<AccountTier, decimal> _quotas = new();

    // VIOLATION: code-quality/deterministic/indexer-non-standard-key-type
    public decimal this[AccountTier tier] => _quotas.TryGetValue(tier, out var q) ? q : 0m;
}

internal enum AccountTier
{
    Free,
    Pro,
    Enterprise,
}
