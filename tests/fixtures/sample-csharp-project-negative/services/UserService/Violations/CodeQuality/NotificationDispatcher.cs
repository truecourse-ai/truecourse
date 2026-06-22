using System.Collections.Generic;

namespace UserServiceApp.Violations.CodeQuality;

internal interface INotification
{
    string Channel { get; }
}

internal sealed class EmailNotification : INotification
{
    public string Channel => "email";

    public string Subject { get; set; } = string.Empty;
}

/// <summary>
/// Routes notifications to channel handlers. It reaches through the abstraction by
/// downcasting and re-tests-then-casts instead of using a type pattern.
/// </summary>
internal sealed class NotificationDispatcher
{
    /// <summary>Routes each notification to its channel handler.</summary>
    public void Dispatch(IEnumerable<INotification> notifications)
    {
        foreach (var notification in notifications)
        {
            // VIOLATION: code-quality/deterministic/cast-interface-to-concrete
            var email = (EmailNotification)notification;
            Send(email.Channel, email.Subject);
        }
    }

    /// <summary>Renders a notification payload to display text.</summary>
    public string Render(object payload)
    {
        // VIOLATION: code-quality/deterministic/use-pattern-over-is-and-cast
        if (payload is EmailNotification)
        {
            var email = (EmailNotification)payload;
            return email.Subject;
        }

        return string.Empty;
    }

    private static void Send(string channel, string subject)
    {
        System.Console.WriteLine($"[{channel}] {subject}");
    }
}
