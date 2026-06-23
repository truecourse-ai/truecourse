using System;
using System.Threading.Tasks;

namespace Positive.Boundary.Reliability;

internal sealed class TaskWithoutTaskSchedulerSafe
{
    internal Task ScheduleAsync(Action work)
    {
        // SAFE: reliability/deterministic/task-without-taskscheduler
        return Task.Factory.StartNew(work, default, TaskCreationOptions.None, TaskScheduler.Default);
    }
}
