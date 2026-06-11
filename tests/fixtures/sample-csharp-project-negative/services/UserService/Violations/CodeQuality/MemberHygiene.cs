namespace UserServiceApp.Violations.CodeQuality;

internal class MemberHygiene
{
    // VIOLATION: code-quality/deterministic/unused-private-member
    private string _legacyToken = "seed-token";

    private DateTime _lastFailureAt;

    // VIOLATION: code-quality/deterministic/mutable-private-member
    private List<string> _recentCodes = new List<string>();

    // VIOLATION: code-quality/deterministic/unused-private-nested-class
    private class RetrySchedule
    {
        public int Attempts { get; set; }
        public int DelaySeconds { get; set; }
    }

    internal void TrackCode(string code)
    {
        _recentCodes.Add(code);
    }

    internal int RecentCodeCount()
    {
        return _recentCodes.Count;
    }

    internal void RecordFailure()
    {
        // VIOLATION: code-quality/deterministic/unread-private-attribute
        _lastFailureAt = DateTime.UtcNow;
    }

    // VIOLATION: code-quality/deterministic/unused-private-method
    private string FormatAuditRow(string actor, string action)
    {
        return $"{actor} performed {action} after {_recentCodes.Count} tracked codes";
    }
}
