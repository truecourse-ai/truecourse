namespace ApiGateway.Violations.Architecture;

/// <summary>A counterparty in the system (person or organization).</summary>
public class Party : SoftDeletableEntity
{
    /// <summary>Human-readable name shown in the UI.</summary>
    public string DisplayName { get; set; } = "";
}

/// <summary>An organization-shaped party with tax identity.</summary>
public class Organization : Party
{
    /// <summary>Government-issued tax identifier.</summary>
    public string TaxId { get; set; } = "";
}

/// <summary>A paying customer organization.</summary>
public class Customer : Organization
{
    /// <summary>Approved credit ceiling for the account.</summary>
    public decimal CreditLimit { get; set; }
}
