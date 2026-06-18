using SampleApi.Domain;
using SampleApi.Repositories;
using SampleApi.Services;

namespace SampleApi.Endpoints;

public static class CustomersEndpoints
{
    // Spec: every endpoint under /api/* requires a Bearer token, and POST
    // /api/customers additionally requires the admin role. This group mounts
    // WITHOUT any auth (no .RequireAuthorization()), so all three customer
    // operations are reachable anonymously.
    // IL-DRIFT: AuthRequirement:auth.bearer.api / POST /api/customers/unprotected
    // IL-DRIFT: AuthRequirement:auth.bearer.api / GET /api/customers/unprotected
    // IL-DRIFT: AuthRequirement:auth.bearer.api / GET /api/customers/{id}/unprotected
    // IL-DRIFT: AuthRequirement:auth.role.admin / POST /api/customers/unprotected
    public static void MapCustomerEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api");

        api.MapPost("/customers", (CreateCustomer body, CustomersService service) =>
        {
            // Returns 201 Created with the standard location header (satisfies the op).
            var customer = service.CreateCustomer(body.Email, body.Name);
            return Results.Created($"/api/customers/{customer.Id}", customer);
        });

        api.MapGet("/customers", (CustomersRepository repo, string? cursor, int limit = 20) =>
        {
            // Clamps the limit and returns the {items, next_cursor} envelope.
            var page = repo.List().Take(Math.Min(limit, 50)).ToList();
            return Results.Ok(new { items = page, next_cursor = (string?)null });
        });

        api.MapGet("/customers/{id}", (Guid id, CustomersRepository repo) =>
        {
            var customer = repo.Get(id);
            if (customer is null)
            {
                // Standard error envelope + 404 (satisfies the op).
                return Results.NotFound(
                    new { error = new { code = "customer_not_found", message = "Customer does not exist" } });
            }

            return Results.Ok(customer);
        });

        // Inferred operation — no authored spec contract, so it carries no auth drift.
        api.MapGet("/loyalty-tiers", (LoyaltyRepository repo) =>
            Results.Ok(repo.ListEligibleTiers("is_active = true")));
    }
}
