using System.Collections.Generic;
using System.Linq;

namespace UserServiceApp.Violations.Performance;

/// <summary>
/// Tracks live sessions in specialized collections — a LinkedList of session ids in
/// arrival order, a SortedSet of priority scores, and a HashSet of banned users.
/// Each access below uses a LINQ extension that has a cheaper concrete-type form.
/// </summary>
// VIOLATION: code-quality/deterministic/csharp-filename-type-mismatch
internal sealed class SessionTracker
{
    private readonly LinkedList<string> _arrivalOrder = new();
    private readonly SortedSet<int> _priorityScores = new();
    private readonly HashSet<int> _bannedUserIds = new();

    internal string OldestSession()
    {
        // VIOLATION: performance/deterministic/prefer-linkedlist-first-last
        return _arrivalOrder.First();
    }

    internal int HighestPriority()
    {
        // VIOLATION: performance/deterministic/prefer-set-minmax-property
        return _priorityScores.Max();
    }

    internal void Ban(int userId)
    {
        // VIOLATION: performance/deterministic/redundant-contains-before-set-op
        if (!_bannedUserIds.Contains(userId))
        {
            _bannedUserIds.Add(userId);
        }
    }
}
