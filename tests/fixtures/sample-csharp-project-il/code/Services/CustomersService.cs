using SampleApi.Data.Entities;

namespace SampleApi.Services;

public class CustomersService
{
    public Customer CreateCustomer(string email, string name)
    {
        // Spec says email is lowercased on write. Storing raw input means two
        // customers with `Foo@Example.com` and `foo@example.com` are not deduped
        // and lowercase-email lookups miss the row.
        // IL-DRIFT: Entity:Customer / field.email.normalize
        return new Customer
        {
            Id = Guid.NewGuid(),
            Email = email,
            Name = name,
            LoyaltyTier = "standard",
            Status = "active",
            CreatedAt = DateTime.UtcNow,
        };
    }
}
