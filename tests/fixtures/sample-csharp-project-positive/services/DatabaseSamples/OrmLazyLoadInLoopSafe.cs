using System.Collections.Generic;
using System.Linq;
using Microsoft.EntityFrameworkCore;

namespace Positive.Boundary.Database;

/// <summary>Builds team summaries from an eagerly-loaded query (no N+1).</summary>
public sealed class OrmLazyLoadInLoopSafe
{
    private readonly DirectoryDbContext _db;

    /// <summary>Creates the service over the given context.</summary>
    public OrmLazyLoadInLoopSafe(DirectoryDbContext db)
    {
        _db = db;
    }

    /// <summary>Returns one summary line per team with its member count.</summary>
    internal List<string> BuildTeamSummaries()
    {
        var summaries = new List<string>();
        // SAFE: database/deterministic/orm-lazy-load-in-loop
        var teams = _db.Teams.Include(t => t.Members).ToList();
        foreach (var team in teams)
        {
            var memberCount = team.Members.Count();
            summaries.Add($"{team.Name}: {memberCount} members");
        }
        return summaries;
    }
}
