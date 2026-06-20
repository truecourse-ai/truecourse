namespace UserServiceApp.Violations.Architecture;

/// <summary>Sends notifications to subscriber webhooks.</summary>
public sealed class WebhookDispatcher
{
    /// <summary>Deliver a notification to the given subscriber endpoint.</summary>
    // VIOLATION: architecture/deterministic/uri-parameter-as-string
    public bool Deliver(string subscriberUrl, string body)
    {
        return subscriberUrl.Length > 0 && body.Length > 0;
    }
}
