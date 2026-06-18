using Api.Models;
using Dapper;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Api.Repositories;

/// <summary>Read/write access to orders.</summary>
public interface IOrderRepository
{
    /// <summary>Loads one order with its lines, or null when absent.</summary>
    Task<Order?> FindAsync(Guid id, CancellationToken cancellationToken);

    /// <summary>Loads a page of orders for one customer.</summary>
    Task<IReadOnlyList<Order>> ListForCustomerAsync(Guid customerId, int limit, CancellationToken cancellationToken);

    /// <summary>Persists a new order and its lines atomically.</summary>
    Task SaveAsync(Order order, CancellationToken cancellationToken);

    /// <summary>Counts orders shipped since the given UTC instant.</summary>
    Task<long> CountShippedSinceAsync(DateTime sinceUtc, CancellationToken cancellationToken);
}

/// <summary>EF Core + Dapper implementation of <see cref="IOrderRepository"/>.</summary>
public class OrderRepository : IOrderRepository
{
    private readonly StoreDbContext _db;
    private readonly string _connectionString;

    /// <summary>Creates the repository over the injected context.</summary>
    public OrderRepository(StoreDbContext db, IConfiguration configuration)
    {
        _db = db;
        _connectionString = configuration.GetConnectionString("Store")
            ?? throw new InvalidOperationException("Store connection string is not configured");
    }

    /// <inheritdoc />
    public async Task<Order?> FindAsync(Guid id, CancellationToken cancellationToken)
    {
        return await _db.Orders
            .Include(order => order.Lines)
            .FirstOrDefaultAsync(order => order.Id == id, cancellationToken);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<Order>> ListForCustomerAsync(Guid customerId, int limit, CancellationToken cancellationToken)
    {
        return await _db.Orders
            .Where(order => order.CustomerId == customerId)
            .OrderByDescending(order => order.CreatedAtUtc)
            .Take(limit)
            .ToListAsync(cancellationToken);
    }

    /// <inheritdoc />
    public async Task SaveAsync(Order order, CancellationToken cancellationToken)
    {
        await using var transaction = await _db.Database.BeginTransactionAsync(cancellationToken);
        _db.Orders.Add(order);
        await _db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    /// <inheritdoc />
    public async Task<long> CountShippedSinceAsync(DateTime sinceUtc, CancellationToken cancellationToken)
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        return await connection.ExecuteScalarAsync<long>(
            "SELECT COUNT(*) FROM orders WHERE status = @Status AND created_at_utc >= @SinceUtc",
            new { Status = (int)OrderStatus.Shipped, SinceUtc = sinceUtc });
    }
}
