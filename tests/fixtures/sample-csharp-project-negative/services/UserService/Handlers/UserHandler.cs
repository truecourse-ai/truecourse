using Shared.Utils;
using UserServiceApp.Services;

namespace UserServiceApp.Handlers;

public static class UserHandler
{
    private static readonly UserServiceApp.Services.UserService _userService = new();

    public static IResult GetUsers()
    {
        var users = _userService.GetAll();
        return Results.Ok(users);
    }

    public static IResult GetUserById(string userId)
    {
        var user = _userService.GetById(userId);
        if (user == null)
        {
            return Results.NotFound(new { error = "Not found" });
        }
        return Results.Ok(user);
    }

    public static IResult CreateUser(Dictionary<string, object> data)
    {
        var name = data["name"].ToString()!;
        var email = data["email"].ToString()!;
        if (!Validators.ValidateEmail(email))
        {
            return Results.BadRequest(new { error = "Invalid email" });
        }
        var user = _userService.Create(new Dictionary<string, object>
        {
            ["name"] = name,
            ["email"] = email
        });
        return Results.Created($"/users/{user["id"]}", user);
    }

    public static IResult DeleteUser(string userId)
    {
        _userService.Delete(userId);
        return Results.NoContent();
    }
}
