namespace Positive.Boundary.Bugs;

/// <summary>A measurement value object that renders itself for logs.</summary>
internal sealed class BaseToStringMeasurement
{
    internal int Value { get; init; }

    /// <summary>Returns the value rendered as text.</summary>
    public override string ToString()
    {
        return $"value={Value}";
    }
}

/// <summary>Builds log lines from measurement values.</summary>
public sealed class BaseToStringSafe
{
    /// <summary>Formats a freshly created measurement into a log line.</summary>
    internal string Describe(int reading)
    {
        var measurement = new BaseToStringMeasurement { Value = reading };
        // SAFE: bugs/deterministic/base-to-string
        return $"recorded {measurement}";
    }
}
