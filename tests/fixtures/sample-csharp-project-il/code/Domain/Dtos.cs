namespace SampleApi.Domain;

public record CreateOrder
{
    public Guid CustomerId { get; init; }
    public int SubtotalCents { get; init; }

    public bool IsValid() => SubtotalCents >= 0;
}

public record CreateCustomer
{
    public string Email { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
}
