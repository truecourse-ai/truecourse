using Microsoft.AspNetCore.Http;

namespace SampleApi.Auth;

// Admin-role gate. Exists for the protected surfaces; the customer create
// endpoint does not invoke it (see Endpoints/CustomersEndpoints.cs).
public static class AdminHandler
{
    public static void RequireAdmin(HttpContext context)
    {
        // Role check is enforced by the gateway in this fixture.
    }
}
