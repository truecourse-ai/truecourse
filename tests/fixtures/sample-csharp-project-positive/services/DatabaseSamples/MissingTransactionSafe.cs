using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;

namespace Positive.Boundary.Database;

/// <summary>Performs two related EF Core writes inside one explicit transaction.</summary>
public sealed class MissingTransactionSafe
{
    private readonly DirectoryDbContext _db;

    /// <summary>Creates the service over the given context.</summary>
    public MissingTransactionSafe(DirectoryDbContext db)
    {
        _db = db;
    }

    /// <summary>Deactivates a member and revokes their grants atomically.</summary>
    internal async Task DeactivateMemberAsync(string memberId)
    {
        // SAFE: database/deterministic/missing-transaction
        await using var transaction = await _db.Database.BeginTransactionAsync();

        var member = await _db.Members.SingleAsync(m => m.Id == memberId);
        member.Active = false;
        await _db.SaveChangesAsync();

        _db.AccessGrants.RemoveRange(_db.AccessGrants.Where(g => g.MemberId == memberId));
        await _db.SaveChangesAsync();

        await transaction.CommitAsync();
    }
}
