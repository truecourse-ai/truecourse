using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using Microsoft.EntityFrameworkCore;

namespace UserServiceApp.Models;

public class AppDbContext : DbContext
{
    public DbSet<User> Users { get; set; } = null!;
    public DbSet<Post> Posts { get; set; } = null!;
    public DbSet<Comment> Comments { get; set; } = null!;
    public DbSet<PostTag> PostTags { get; set; } = null!;

    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
    {
        optionsBuilder.UseNpgsql("Host=localhost;Port=5432;Database=app;Username=app;Password=secret");
    }
}

public class User
{
    [Key]
    public string Id { get; set; } = null!;

    [Required]
    public string Email { get; set; } = null!;

    public string? Name { get; set; }

    public List<Post> Posts { get; set; } = new();

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class Post
{
    [Key]
    public string Id { get; set; } = null!;

    [Required]
    public string Title { get; set; } = null!;

    public string? Content { get; set; }

    public bool Published { get; set; } = false;

    [ForeignKey("User")]
    public string UserId { get; set; } = null!;

    public User User { get; set; } = null!;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class Comment
{
    [Key]
    public string Id { get; set; } = null!;

    public string? Body { get; set; }

    public string? CategoryId { get; set; }

    public string? PostId { get; set; }

    public int? Rating { get; set; }

    public int? ViewCount { get; set; }

    public string Status { get; set; } = "draft";
}

public class PostTag
{
    [Key]
    public string PostId { get; set; } = null!;

    public string? Tag { get; set; }

    public string? Label { get; set; }
}
