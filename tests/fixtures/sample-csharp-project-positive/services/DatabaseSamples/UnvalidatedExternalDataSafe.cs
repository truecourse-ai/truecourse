using Microsoft.EntityFrameworkCore;

namespace Positive.Boundary.Database;

internal sealed class UnvalidatedExternalDataSafe
{
    private readonly AppDbContext _db;

    internal UnvalidatedExternalDataSafe(AppDbContext db) => _db = db;

    internal void Register(RegistrationForm form)
    {
        // SAFE: database/deterministic/unvalidated-external-data
        _db.Users.Add(new User { Email = form.Email });
        _db.SaveChanges();
    }
}

internal sealed record RegistrationForm
{
    internal string Email { get; init; } = "";
}

internal sealed record User
{
    internal string Email { get; init; } = "";
}

internal sealed class AppDbContext : DbContext
{
    internal DbSet<User> Users => Set<User>();
}
