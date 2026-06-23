using System;

namespace Positive.Boundary.Bugs;

/// <summary>Channels a notification may target, as a bit set.</summary>
[Flags]
public enum NotificationChannels
{
    /// <summary>No channel.</summary>
    None = 0,

    /// <summary>Email channel.</summary>
    Email = 1,

    /// <summary>Security alert channel.</summary>
    Security = 2,
}

/// <summary>Checks notification channel membership against the same enum type.</summary>
public sealed class HasFlagWrongEnumTypeSafe
{
    /// <summary>Returns whether the security channel is selected.</summary>
    internal bool IncludesSecurity(NotificationChannels selected)
    {
        // SAFE: bugs/deterministic/hasflag-wrong-enum-type
        return selected.HasFlag(NotificationChannels.Security);
    }
}
