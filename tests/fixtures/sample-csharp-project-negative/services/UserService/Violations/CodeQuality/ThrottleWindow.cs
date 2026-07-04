namespace UserServiceApp.Violations.CodeQuality;

internal sealed class ThrottleWindow
{
    internal int SlotFor(int requestId)
    {
        // VIOLATION: code-quality/deterministic/magic-number
        return requestId % 47;
    }
}
