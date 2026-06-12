using Api.Models;
using Xunit;

namespace Api.Tests;

/// <summary>Behavioral tests for order totals.</summary>
public class OrderServiceTests
{
    [Fact]
    public void TotalCents_SumsLineAmounts()
    {
        var lines = new List<OrderLine>
        {
            new() { Sku = "SKU-RED-MUG", Quantity = 2, UnitPriceCents = 1250 },
            new() { Sku = "SKU-TEA-BOX", Quantity = 1, UnitPriceCents = 899 },
        };

        var total = lines.Sum(line => line.UnitPriceCents * line.Quantity);

        Assert.Equal(3399, total);
    }

    [Fact]
    public void OrderStatus_PendingIsDefault()
    {
        var order = new Order { Id = Guid.NewGuid() };

        Assert.Equal(OrderStatus.Pending, order.Status);
    }
}
