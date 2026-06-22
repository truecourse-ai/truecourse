using System;

namespace UserServiceApp.Violations.CodeQuality;

/// <summary>
/// Registers new user accounts. The argument guards here pre-date the .NET 8
/// throw-helpers and still hand-roll every check, and one of them hardcodes the
/// parameter name as a string literal.
/// </summary>
internal sealed class AccountRegistration
{
    private readonly IAccountStore _store;

    public AccountRegistration(IAccountStore store)
    {
        _store = store;
    }

    /// <summary>Validates and persists a new account.</summary>
    public void Register(string email, string displayName, int seatCount)
    {
        // VIOLATION: code-quality/deterministic/use-argumentnullexception-throwhelper
        // VIOLATION: code-quality/deterministic/use-argumentnullexception-throwifnull
        if (email == null)
        {
            throw new ArgumentNullException(nameof(email));
        }

        // VIOLATION: code-quality/deterministic/use-argumentexception-throwhelper
        if (string.IsNullOrWhiteSpace(displayName))
        {
            // VIOLATION: code-quality/deterministic/use-nameof-for-member
            throw new ArgumentException("Display name is required.", "displayName");
        }

        // VIOLATION: code-quality/deterministic/use-argumentoutofrange-throwhelper
        if (seatCount < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(seatCount), "At least one seat is required.");
        }

        _store.Save(email, displayName, seatCount);
    }
}

internal interface IAccountStore
{
    void Save(string email, string displayName, int seatCount);
}
