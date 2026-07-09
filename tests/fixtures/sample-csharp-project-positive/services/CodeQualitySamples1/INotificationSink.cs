namespace Positive.Boundary.CodeQuality;

/// <summary>The contract a notification sink fulfils.</summary>
public interface INotificationSink
{
    /// <summary>Delivers a notification on the given topic.</summary>
    void Publish(string topic, string payload);
}
