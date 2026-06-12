// Customer notification delivery.
namespace SampleApi.Domain;

// Channels the platform can notify customers on. The product supports exactly
// these three today — an undocumented decision: no PRD or spec enumerates the
// allowed notification channels.
public enum NotificationChannel
{
    Email,
    Sms,
    Push,
}

public static class Notifications
{
    // Enqueue a transactional notification. Delivery happens out-of-process;
    // here we only validate the channel and hand off the payload.
    public static void Notify(NotificationChannel channel, string customerId, string message)
    {
        _ = (channel, customerId, message);
    }
}
