using System;
using Microsoft.Azure.Functions.Worker;

namespace ApiGateway.Violations.Reliability;

internal sealed class FunctionsHost
{
    private readonly IProcessor _processor;
    private readonly ISweeper _sweeper;
    private int _failures;

    internal FunctionsHost(IProcessor processor, ISweeper sweeper)
    {
        _processor = processor;
        _sweeper = sweeper;
    }

    internal int Failures => _failures;

    [Function("ProcessQueue")]
    // VIOLATION: reliability/deterministic/azure-function-no-error-handling
    internal void ProcessQueue([QueueTrigger("orders")] string message)
    {
        var order = Order.Parse(message);
        _processor.Handle(order);
    }

    [Function("Sweep")]
    internal void Sweep([TimerTrigger("0 */5 * * * *")] TimerInfo timer)
    {
        _sweeper.LastRun = timer.ScheduleStatus;
        try
        {
            _sweeper.Sweep();
        }
        // VIOLATION: reliability/deterministic/azure-function-failure-not-logged
        catch (Exception)
        {
            _failures++;
        }
    }
}

internal interface IProcessor
{
    void Handle(Order order);
}

internal interface ISweeper
{
    string? LastRun { get; set; }

    void Sweep();
}

internal sealed class Order
{
    internal string Source { get; private init; } = string.Empty;

    internal static Order Parse(string message) => new() { Source = message };
}

internal sealed class TimerInfo
{
    internal string ScheduleStatus { get; init; } = string.Empty;
}
