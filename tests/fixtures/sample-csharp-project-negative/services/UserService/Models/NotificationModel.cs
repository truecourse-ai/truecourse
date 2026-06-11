namespace UserServiceApp.Models;

public enum NotificationChannel
{
    Email,
    Sms,
    Push
}

public enum NotificationPriority
{
    Low,
    Medium,
    High
}

public class BaseNotification
{
    public string Title { get; set; } = null!;
    public string Body { get; set; } = null!;
}

public class Notification : BaseNotification
{
    public NotificationChannel? Channel { get; set; }
    public NotificationPriority? Priority { get; set; }
    public List<string> Recipients { get; set; } = new();
}
