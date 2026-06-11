namespace UserServiceApp.Violations.CodeQuality;

internal class MessageComposer
{
    private readonly ILogger _logger;
    private readonly List<string> _outbox = new List<string>();

    public MessageComposer(ILogger logger)
    {
        _logger = logger;
    }

    internal void AnnounceBatch(string summary)
    {
        // VIOLATION: code-quality/deterministic/console-log
        Console.WriteLine(summary);
    }

    internal void LogDispatch(int count)
    {
        // VIOLATION: code-quality/deterministic/logging-string-format
        _logger.LogInformation($"Dispatched {count} messages");
    }

    internal string ComposeSubject(string orderId, string customerName)
    {
        // VIOLATION: code-quality/deterministic/prefer-template
        var subject = "Order " + orderId + " update for " + customerName;
        _outbox.Add(subject);
        return subject;
    }

    internal string ComposeBanner(string cycle)
    {
        // VIOLATION: code-quality/deterministic/useless-concat
        var banner = "ACME " + "Billing " + cycle;
        _outbox.Add(banner);
        return banner;
    }

    internal void QueueDeliveryAlerts(List<string> stops)
    {
        foreach (var stop in stops)
        {
            // VIOLATION: code-quality/deterministic/magic-string
            // VIOLATION: code-quality/deterministic/duplicate-string
            _outbox.Add("delivery window missed");
            _logger.LogWarning("delivery window missed");
            RecordIncident(stop, "delivery window missed");
        }
    }

    internal string ComposeTrace(string nodeId)
    {
        // VIOLATION: code-quality/deterministic/nested-template-literal
        // VIOLATION: code-quality/deterministic/deeply-nested-fstring
        var trace = $"batch {$"shard {$"node {nodeId}"}"}";
        _outbox.Add(trace);
        return trace;
    }

    internal string ComposeApology()
    {
        // VIOLATION: code-quality/deterministic/useless-escape
        var apology = "We\'re sorry for the delay";
        _outbox.Add(apology);
        return apology;
    }

    internal void RecordIncident(string stop, string reason)
    {
        _outbox.Add($"{stop}: {reason}");
    }
}
