using SampleApi.Data;
using SampleApi.Data.Entities;

namespace SampleApi.Repositories;

// Customers persistence — EF Core over the Postgres `customers` table.
public class CustomersRepository
{
    private readonly AppDbContext _db;

    public CustomersRepository(AppDbContext db) => _db = db;

    public Customer? Get(Guid customerId) => _db.Customers.FirstOrDefault(c => c.Id == customerId);

    public List<Customer> List()
    {
        // Spec allows listing customers in the `active` OR `pending` states.
        // This filter only admits `active`, silently hiding every pending signup
        // from the list view.
        // IL-DRIFT: QueryRule:customers-list.status-allowlist / query.predicate.value-mismatch.status.in
        var allowed = new[] { "active" };
        return _db.Customers
            .Where(c => allowed.Contains(c.Status))
            .OrderByDescending(c => c.CreatedAt)
            .ToList();
    }
}
