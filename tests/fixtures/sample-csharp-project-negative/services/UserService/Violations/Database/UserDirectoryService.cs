using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace UserServiceApp.Violations.Database;

internal sealed class UserDirectoryService
{
    private readonly DirectoryDbContext _db;

    internal UserDirectoryService(DirectoryDbContext db)
    {
        _db = db;
    }

    // VIOLATION: database/deterministic/missing-transaction
    internal async Task DeactivateMemberAsync(string memberId)
    {
        var member = await _db.Members.SingleAsync(m => m.Id == memberId);
        member.Active = false;
        await _db.SaveChangesAsync();

        _db.AccessGrants.RemoveRange(_db.AccessGrants.Where(g => g.MemberId == memberId));
        await _db.SaveChangesAsync();
    }

    internal List<string> BuildTeamSummaries()
    {
        var summaries = new List<string>();
        var teams = _db.Teams.ToList();
        foreach (var team in teams)
        {
            // VIOLATION: database/deterministic/orm-lazy-load-in-loop
            var memberCount = team.Members.Count();
            summaries.Add($"{team.Name}: {memberCount} members");
        }
        return summaries;
    }

    internal void RegisterMember(HttpRequest request)
    {
        // VIOLATION: database/deterministic/unvalidated-external-data
        _db.Members.Add(new Member
        {
            Email = request.Form["email"],
            DisplayName = request.Form["display_name"],
        });
        _db.SaveChanges();
    }
}
