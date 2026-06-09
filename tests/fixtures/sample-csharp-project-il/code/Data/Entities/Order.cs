using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace SampleApi.Data.Entities;

[Table("orders")]
public class Order
{
    [Key]
    [Column("id")]
    public Guid Id { get; set; }

    [Column("status")]
    public string Status { get; set; } = "placed";

    [Column("subtotal_cents")]
    public int SubtotalCents { get; set; }

    [Column("discount_cents")]
    public int DiscountCents { get; set; }

    [Column("tax_cents")]
    public int TaxCents { get; set; }

    [Column("customer_id")]
    public Guid CustomerId { get; set; }

    [Column("tenant_id")]
    public Guid TenantId { get; set; }

    [Column("placed_at")]
    public DateTime PlacedAt { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    [Column("updated_at")]
    public DateTime UpdatedAt { get; set; }

    [Column("deleted_at")]
    public DateTime? DeletedAt { get; set; }
}
