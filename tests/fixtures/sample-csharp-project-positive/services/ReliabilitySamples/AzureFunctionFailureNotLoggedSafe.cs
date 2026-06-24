using System;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

namespace Positive.Boundary.Reliability;

/// <summary>Azure Function that logs every caught failure before swallowing it.</summary>
internal sealed class AzureFunctionFailureNotLoggedSafe
{
    private readonly ILogger<AzureFunctionFailureNotLoggedSafe> _logger;
    private readonly ISweeper _sweeper;

    internal AzureFunctionFailureNotLoggedSafe(ILogger<AzureFunctionFailureNotLoggedSafe> logger, ISweeper sweeper)
    {
        _logger = logger;
        _sweeper = sweeper;
    }

    [Function("Sweep")]
    internal void Sweep([TimerTrigger("0 */5 * * * *")] TimerInfo timer)
    {
        try
        {
            _sweeper.Sweep(timer.ScheduleStatus);
        }
        // SAFE: reliability/deterministic/azure-function-failure-not-logged
        catch (Exception exception)
        {
            _logger.LogError(exception, "Sweep failed for schedule {Status}", timer.ScheduleStatus);
        }
    }
}

internal interface ISweeper
{
    void Sweep(string status);
}

internal sealed class TimerInfo
{
    internal string ScheduleStatus { get; init; } = string.Empty;
}
