using System.Threading.Tasks;

namespace Positive.Boundary.Bugs;

/// <summary>Schedules a flush, returning an already-completed task when disabled.</summary>
public sealed class ReturnNullTaskSafe
{
    private readonly bool _enabled;

    /// <summary>Creates a scheduler that is active only when <paramref name="enabled"/> is set.</summary>
    public ReturnNullTaskSafe(bool enabled) => _enabled = enabled;

    /// <summary>Flushes pending work, or completes immediately when disabled.</summary>
    internal Task FlushAsync()
    {
        if (_enabled)
        {
            return Task.Delay(0);
        }

        // SAFE: bugs/deterministic/return-null-task
        return Task.CompletedTask;
    }
}
