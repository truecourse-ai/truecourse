using SampleApi.Data;
using SampleApi.Data.Entities;

namespace SampleApi.Repositories;

// Orders persistence — EF Core over the Postgres `orders` table.
public class OrdersRepository
{
    private readonly AppDbContext _db;

    public OrdersRepository(AppDbContext db) => _db = db;

    public Order? Get(Guid id) => _db.Orders.FirstOrDefault(o => o.Id == id);

    public List<Order> List(DateTime since, DateTime until)
    {
        // Spec scopes orders list by tenant (`tenant_id`), anchors the date
        // window on `placed_at`, and INCLUDES soft-deleted rows so the audit
        // view stays complete. This query gets all three wrong: no tenant
        // predicate, the window is anchored on `created_at`, and it filters
        // soft-deleted rows out entirely.
        // IL-DRIFT: QueryRule:orders-list.tenant-scope / query.predicate.missing.tenant_id.eq
        // IL-DRIFT: QueryRule:orders-list.date-anchor / query.date-binding.column-mismatch
        // IL-DRIFT: QueryRule:orders-list.no-soft-deleted-included / query.predicate.forbidden-present.deleted_at.is-null
        return _db.Orders
            .Where(o => o.CreatedAt >= since)
            .Where(o => o.CreatedAt < until)
            .Where(o => o.DeletedAt == null)
            .OrderByDescending(o => o.PlacedAt)
            .ToList();
    }
}
