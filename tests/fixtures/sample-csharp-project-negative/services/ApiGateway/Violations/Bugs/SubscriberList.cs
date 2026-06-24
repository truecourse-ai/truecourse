namespace ApiGateway.Violations.Bugs;

internal sealed class SubscriberList
{
    // VIOLATION: code-quality/deterministic/non-private-field
    // VIOLATION: bugs/deterministic/readonly-mutable-reference-field
    public readonly List<string> Subscribers = new();

    internal void Add(string subscriber) => Subscribers.Add(subscriber);
}
