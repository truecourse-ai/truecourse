using ApiGateway.Routes;

namespace ApiGateway;

public class Program
{
    public static void Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);
        var app = builder.Build();

        HealthRoutes.MapRoutes(app);
        UserRoutes.MapRoutes(app);

        var port = Environment.GetEnvironmentVariable("PORT") ?? "3000";
        app.Run($"http://0.0.0.0:{port}");
    }
}
