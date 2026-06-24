using System;
using System.Threading;

namespace Positive.Boundary.Reliability;

internal sealed class ThreadResumeSuspendSafe
{
    internal void Pause(TimeSpan delay)
    {
        // SAFE: reliability/deterministic/thread-resume-suspend
        Thread.Sleep(delay);
    }
}
