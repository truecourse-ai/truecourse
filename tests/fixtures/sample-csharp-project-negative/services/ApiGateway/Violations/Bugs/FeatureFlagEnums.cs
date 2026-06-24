using System;

namespace ApiGateway.Violations.Bugs;

// A plain (non-[Flags]) enum of mutually exclusive request priorities. Combining
// its members with bitwise OR is a category mistake.
// VIOLATION: code-quality/deterministic/csharp-filename-type-mismatch
internal enum RequestPriority
{
    Low,
    Normal,
    High,
}

// A [Flags] enum whose members were declared with the default sequential values
// (0, 1, 2, 3...) instead of distinct powers of two — so the bits overlap. The
// singular name also reads wrong for a bit-set type.
// VIOLATION: bugs/deterministic/non-flags-enum-with-flags-attribute
// VIOLATION: code-quality/deterministic/flags-enum-singular-name
[Flags]
// VIOLATION: bugs/deterministic/non-flags-enum-with-flags-attribute
internal enum AuditChannel
{
    None,
    Email,
    Pager,
    Dashboard,
}

// A [Flags] enum where most members are powers of two, but one stray member (3)
// is not, and a composite member references a bit (8) no single member backs.
// VIOLATION: code-quality/deterministic/flags-enum-singular-name
[Flags]
// VIOLATION: bugs/deterministic/non-flags-enum-with-flags-attribute
internal enum NotificationScope
{
    None = 0,
    Account = 1,
    Billing = 2,
    // VIOLATION: bugs/deterministic/flags-enum-non-power-of-two
    Legacy = 3,
    Security = 4,
    // VIOLATION: bugs/deterministic/enum-undefined-composite-flag
    // VIOLATION: bugs/deterministic/flags-enum-non-power-of-two
    Everything = 1 | 2 | 8,
}

internal sealed class NotificationRouter
{
    internal RequestPriority Escalate(RequestPriority current)
    {
        // VIOLATION: bugs/deterministic/bitwise-on-non-flags-enum
        return current | RequestPriority.High;
    }

    internal bool ShouldPage(AuditChannel selected)
    {
        // VIOLATION: bugs/deterministic/hasflag-wrong-enum-type
        return selected.HasFlag(NotificationScope.Security);
    }
}
