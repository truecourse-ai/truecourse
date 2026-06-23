namespace Positive.Boundary.CodeQuality;

/// <summary>
/// An abstract base whose constructor is correctly declared <c>protected</c>.
/// Since only subclasses can call it, <c>protected</c> states the real contract
/// and the rule must not fire (it only flags <c>public</c> constructors).
/// </summary>
public abstract class AbstractClassPublicConstructorSafe
{
    /// <summary>The account this entry belongs to.</summary>
    protected string Account { get; }

    /// <summary>Initializes the shared account state for subclasses.</summary>
    // SAFE: code-quality/deterministic/abstract-class-public-constructor
    protected AbstractClassPublicConstructorSafe(string account)
    {
        Account = account;
    }

    /// <summary>Settles the entry and returns the resulting balance.</summary>
    public abstract decimal Settle();
}
