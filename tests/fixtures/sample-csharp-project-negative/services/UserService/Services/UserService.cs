using UserServiceApp.Repositories;

namespace UserServiceApp.Services;

public class UserService
{
    private readonly UserRepository _repo;

    public UserService()
    {
        _repo = new UserRepository();
    }

    public List<Models.User> GetAll()
    {
        return _repo.FindAll();
    }

    public Models.User? GetById(string userId)
    {
        return _repo.FindById(userId);
    }

    public Dictionary<string, object> Create(Dictionary<string, object> data)
    {
        var user = _repo.Create(data);
        return new Dictionary<string, object>
        {
            ["id"] = user.Id,
            ["name"] = user.Name!,
            ["email"] = user.Email
        };
    }

    public void Delete(string userId)
    {
        _repo.Delete(userId);
    }
}
