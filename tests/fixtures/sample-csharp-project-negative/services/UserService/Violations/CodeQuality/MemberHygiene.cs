namespace UserServiceApp.Violations.CodeQuality;

internal class MemberHygiene
{
    // VIOLATION: code-quality/deterministic/unused-private-member
    // VIOLATION: code-quality/deterministic/field-can-be-readonly
    private string _legacyToken = "seed-token";

    private DateTime _lastFailureAt;

    // VIOLATION: code-quality/deterministic/mutable-private-member
    // VIOLATION: code-quality/deterministic/field-can-be-readonly
    private List<string> _recentCodes = new List<string>();

    // VIOLATION: code-quality/deterministic/unused-private-nested-class
    // VIOLATION: performance/deterministic/non-derived-private-class-not-sealed
    private class RetrySchedule
    {
        // VIOLATION: code-quality/deterministic/member-more-visible-than-type
        public int Attempts { get; set; }
        // VIOLATION: code-quality/deterministic/member-more-visible-than-type
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
