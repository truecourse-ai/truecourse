using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Api.Models;

/// <summary>A single product line within an order.</summary>
public class OrderLine
{
    /// <summary>Primary key.</summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>Owning order.</summary>
    [Column("order_id")]
    public Guid OrderId { get; set; }

    /// <summary>Stock-keeping unit of the product.</summary>
    public string Sku { get; set; } = string.Empty;

    /// <summary>Number of units ordered.</summary>
    public int Quantity { get; set; }

    /// <summary>Price per unit in the smallest currency unit.</summary>
    [Column("unit_price_cents")]
    public long UnitPriceCents { get; set; }
}
