using System.Threading.Tasks;

namespace UserServiceApp.Violations.CodeQuality;

internal class TelemetryPublisher
{
    private const int FlushDelayMs = 5;

    // VIOLATION: code-quality/deterministic/async-method-naming
    internal async Task Publish()
    {
        await Task.Delay(FlushDelayMs);
    }
}
