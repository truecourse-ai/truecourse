using Microsoft.AspNetCore.Http;

namespace SampleApi.Auth;

// Bearer-token gate. The mechanism exists and is correct; the drift is that the
// customer endpoints never apply it (see Endpoints/CustomersEndpoints.cs).
public static class BearerHandler
{
    public static void RequireBearer(HttpContext context)
    {
        if (!context.Request.Headers.ContainsKey("Authorization"))
        {
            throw new InvalidOperationException("missing bearer token");
        }
    }
}
