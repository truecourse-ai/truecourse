using UserServiceApp.Models;
using UserServiceApp.Handlers;

namespace UserServiceApp.Repositories;

public class UserRepository
{
    private readonly AppDbContext _context;

    public UserRepository()
    {
        _context = new AppDbContext();
    }

    public List<User> FindAll()
    {
        // Architecture defect (asserted by the graph tests): data layer calling up into the handler layer
        var _ = UserHandler.GetUsers();
        return _context.Users.ToList();
    }

    public User? FindById(string userId)
    {
        return _context.Users.Find(userId);
    }

    public User Create(Dictionary<string, object> data)
    {
        var user = new User
        {
            Id = Guid.NewGuid().ToString(),
            Name = data["name"].ToString(),
            Email = data["email"].ToString()!
        };
        _context.Users.Add(user);
        _context.SaveChanges();
        return user;
    }

    public void Delete(string userId)
    {
        var user = _context.Users.Find(userId);
        if (user != null)
        {
            _context.Users.Remove(user);
            _context.SaveChanges();
        }
    }
}
