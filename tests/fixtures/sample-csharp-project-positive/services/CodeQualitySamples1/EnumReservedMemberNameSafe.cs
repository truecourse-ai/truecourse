namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Holds an enum with a member whose name starts with <c>Reserved</c> but is a
/// real, meaningful value rather than a bare placeholder. The rule matches only
/// the exact pattern <c>Reserved</c> optionally followed by digits, so
/// <c>ReservedSeat</c> must not fire.
/// </summary>
public static class EnumReservedMemberNameSafe
{
    /// <summary>Seat allocation states, each carrying real meaning.</summary>
    public enum SeatState
    {
        Open = 0,
        // SAFE: code-quality/deterministic/enum-reserved-member-name
        ReservedSeat = 1,
        Occupied = 2,
    }
}
