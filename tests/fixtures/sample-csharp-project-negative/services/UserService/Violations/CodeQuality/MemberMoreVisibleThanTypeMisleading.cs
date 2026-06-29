namespace UserServiceApp.Violations.CodeQuality;

internal sealed class MemberMoreVisibleThanTypeMisleading
{
    // A private nested type: its members can never be reached from outside the
    // enclosing type, so a `public` modifier here is dead and misleading. The
    // member implements no interface, so the broader accessibility has no effect.
    private sealed class Counter
    {
        // VIOLATION: code-quality/deterministic/member-more-visible-than-type
        public int Value { get; set; }
    }

    internal int Bump()
    {
        var counter = new Counter();
        counter.Value++;
        return counter.Value;
    }
}
