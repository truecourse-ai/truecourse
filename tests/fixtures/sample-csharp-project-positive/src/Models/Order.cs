using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Api.Models;

/// <summary>A customer order and its lifecycle state.</summary>
public class Order
{
    /// <summary>Primary key.</summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>Identifier of the customer who placed the order.</summary>
    [Column("customer_id")]
    public Guid CustomerId { get; set; }

    /// <summary>Current lifecycle status.</summary>
    public OrderStatus Status { get; set; }

    /// <summary>Total in the smallest currency unit.</summary>
    [Column("total_cents")]
    public long TotalCents { get; set; }

    /// <summary>Creation timestamp in UTC.</summary>
    [Column("created_at_utc")]
    public DateTime CreatedAtUtc { get; set; }

    /// <summary>Line items in this order.</summary>
    public List<OrderLine> Lines { get; set; } = new();
}

/// <summary>Lifecycle states an order moves through.</summary>
public enum OrderStatus
{
    /// <summary>Created but not yet paid.</summary>
    Pending,

    /// <summary>Payment confirmed.</summary>
    Paid,

    /// <summary>Handed to the carrier.</summary>
    Shipped,

    /// <summary>Cancelled before shipping.</summary>
    Cancelled,
}
