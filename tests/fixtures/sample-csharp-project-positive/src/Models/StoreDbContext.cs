using Microsoft.EntityFrameworkCore;

namespace Api.Models;

/// <summary>Entity Framework context for the store database.</summary>
public class StoreDbContext : DbContext
{
    /// <summary>Creates the context with injected options.</summary>
    public StoreDbContext(DbContextOptions<StoreDbContext> options) : base(options)
    {
    }

    /// <summary>Orders placed by customers.</summary>
    public DbSet<Order> Orders => Set<Order>();

    /// <summary>Line items belonging to orders.</summary>
    public DbSet<OrderLine> OrderLines => Set<OrderLine>();
}
