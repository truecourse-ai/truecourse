namespace UserServiceApp.Violations.Bugs;

internal class GreeterBase
{
    internal virtual string Greet()
    {
        return "hi";
    }
}

internal sealed class RedundantBaseGreeter : GreeterBase
{
    internal string Announce()
    {
        // RedundantBaseGreeter declares no `Greet` member of its own, so the
        // `base.` qualifier is unnecessary and misleads readers about which
        // member runs.
        // VIOLATION: bugs/deterministic/redundant-base-call
        return base.Greet();
    }
}
