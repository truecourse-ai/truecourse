using System.Threading.Tasks;
using Microsoft.AspNetCore.Components;

namespace Utils.Violations.Reliability;

// A Blazor UI component: awaits that mutate component state must resume on the
// captured SynchronizationContext, so ConfigureAwait(false) is the wrong advice
// here — detaching from the UI context is a bug, not a fix. The rule must NOT
// fire on a component await (no marker).
public class NotificationPanel : ComponentBase
{
    // Refreshes the panel; the continuation must run back on the UI context.
    public async Task RefreshAsync()
    {
        await Task.Delay(1);
    }
}

// Plain shared-library code (not a UI component): a captured context can deadlock
// a caller that blocks on the returned task, so the missing ConfigureAwait(false)
// is a genuine bug here.
public sealed class BackgroundSyncer
{
    // Runs one background synchronization step.
    public async Task RunAsync()
    {
        // VIOLATION: reliability/deterministic/missing-configureawait
        await Task.Delay(2);
    }
}
