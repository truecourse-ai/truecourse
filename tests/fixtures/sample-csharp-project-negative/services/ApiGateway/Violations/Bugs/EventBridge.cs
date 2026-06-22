namespace ApiGateway.Violations.Bugs;

internal sealed class EventBridge
{
    private readonly Sensor _sensor;
    private int _processed;

    internal EventBridge(Sensor sensor)
    {
        _sensor = sensor;
    }

    internal void Detach()
    {
        // VIOLATION: bugs/deterministic/anonymous-delegate-unsubscribe
        _sensor.Reading -= (sender, reading) => Process(reading);
    }

    internal void Flush()
    {
        // VIOLATION: bugs/deterministic/empty-statement
        Persist();;
    }

    private void Process(int reading)
    {
        _processed += reading;
    }

    private void Persist()
    {
        _processed = 0;
    }
}
