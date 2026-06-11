using UserServiceApp.Db;
using UserServiceApp.Handlers;

namespace UserServiceApp;

public class Program
{
    public static void Main(string[] args)
    {
        DbConnection.ConnectDatabase();

        var builder = WebApplication.CreateBuilder(args);
        var app = builder.Build();

        app.MapGet("/users", () => UserHandler.GetUsers());
        app.MapGet("/users/{userId}", (string userId) => UserHandler.GetUserById(userId));
        app.MapPost("/users", (Dictionary<string, object> data) => UserHandler.CreateUser(data));
        app.MapDelete("/users/{userId}", (string userId) => UserHandler.DeleteUser(userId));

        var port = Environment.GetEnvironmentVariable("PORT") ?? "3001";
        app.Run($"http://0.0.0.0:{port}");
    }
}
