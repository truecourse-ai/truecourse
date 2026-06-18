using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace UserServiceApp.Models;

public class Token
{
    [Key]
    public long Id { get; set; }

    [Required]
    [ForeignKey("User")]
    public long UserId { get; set; }

    [Required]
    [MaxLength(255)]
    public string Value { get; set; } = null!;

    [MaxLength(64)]
    public string? Context { get; set; }

    public User User { get; set; } = null!;
}
