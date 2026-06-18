// ADR-001 fixes Postgres as the system of record, but the MongoDB driver is
// also pulled in from a half-finished migration — a forbidden data-store
// alternative.
// IL-DRIFT: ArchitectureDecision:data-store.postgres / architecture.data-store.forbidden-alternative
using Microsoft.EntityFrameworkCore;
using MongoDB.Driver; // leftover from the abandoned Mongo migration
using SampleApi.Data.Entities;

namespace SampleApi.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    public DbSet<Order> Orders => Set<Order>();
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<LoyaltyTier> LoyaltyTiers => Set<LoyaltyTier>();

    protected override void OnConfiguring(DbContextOptionsBuilder options)
    {
        if (!options.IsConfigured)
        {
            options.UseNpgsql("Host=localhost;Database=orders;Username=app");
        }
    }
}
