using ApiGateway.Services;

namespace ApiGateway.Controllers;

public class UserController
{
    private readonly UserService _userService;

    public UserController()
    {
        _userService = new UserService();
    }

    public IResult GetAll()
    {
        var users = _userService.FindAll();
        return Results.Ok(users);
    }

    public IResult GetById(string userId)
    {
        var user = _userService.FindById(userId);
        if (user == null)
        {
            return Results.NotFound(new { error = "User not found" });
        }
        return Results.Ok(user);
    }

    public IResult Create(Dictionary<string, object> data)
    {
        var user = _userService.Create(data);
        return Results.Created($"/users/{user["id"]}", user);
    }

    public IResult Delete(string userId)
    {
        _userService.Delete(userId);
        return Results.NoContent();
    }
}
