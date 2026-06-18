using ApiGateway.Services;

namespace ApiGateway.Routes;

public static class HealthRoutes
{
    public static void MapRoutes(WebApplication app)
    {
        var healthService = new HealthService();

        app.MapGet("/api/health", () =>
        {
            return Results.Ok(healthService.Check());
        });
    }
}
