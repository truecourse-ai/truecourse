using System.Diagnostics;

namespace ApiGateway.Services;

public class HealthService
{
    private static readonly Stopwatch _uptime = Stopwatch.StartNew();

    public Dictionary<string, object> Check()
    {
        return new Dictionary<string, object>
        {
            ["status"] = "ok",
            ["uptime"] = _uptime.Elapsed.TotalSeconds
        };
    }
}
