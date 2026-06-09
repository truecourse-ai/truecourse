using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace SampleApi.Data.Entities;

[Table("loyalty_tiers")]
public class LoyaltyTier
{
    [Key]
    [Column("code")]
    public string Code { get; set; } = string.Empty;

    [Column("name")]
    public string Name { get; set; } = string.Empty;

    [Column("threshold")]
    public int Threshold { get; set; }

    [Column("is_active")]
    public bool IsActive { get; set; }
}
