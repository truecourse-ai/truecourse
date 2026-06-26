namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A null-object implementation of <see cref="INotificationSink"/>: every member
/// is an intentional no-op, which is the whole purpose of the type. The
/// empty-function rules must treat these do-nothing bodies as deliberate, not as
/// missing implementations.
/// </summary>
// SAFE: code-quality/deterministic/empty-function
public sealed class NullNotificationSink : INotificationSink
{
    /// <summary>Drops the notification; the null sink never delivers anything.</summary>
    public void Publish(string topic, string payload)
    {
    }
}
