using ApiGateway.Controllers;

namespace ApiGateway.Routes;

public static class UserRoutes
{
    public static void MapRoutes(WebApplication app)
    {
        var controller = new UserController();

        app.MapGet("/api/users", () => controller.GetAll());
        app.MapGet("/api/users/{userId}", (string userId) => controller.GetById(userId));
        app.MapPost("/api/users", (Dictionary<string, object> data) => controller.Create(data));
        app.MapDelete("/api/users/{userId}", (string userId) => controller.Delete(userId));
    }
}
