namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Numeric literals passed as <em>named</em> call arguments
/// (<c>maxLength: 128</c>) are self-documenting: the parameter name explains
/// what the value means, so the magic-number rule must not flag them.
/// </summary>
public sealed class NamedArgumentColumns
{
    private readonly IColumnSink _sink;

    /// <summary>Creates the plan over the given sink.</summary>
    public NamedArgumentColumns(IColumnSink sink)
    {
        _sink = sink;
    }

    /// <summary>Declares the columns for a table.</summary>
    public void Configure()
    {
        // SAFE: code-quality/deterministic/magic-number
        // Every literal below is a named argument, so its meaning is explicit.
        _sink.AddColumn(name: "title", maxLength: 128, nullable: false);
        _sink.AddColumn(name: "summary", maxLength: 4000, nullable: true);
    }
}

/// <summary>Receives column definitions.</summary>
public interface IColumnSink
{
    /// <summary>Adds a column with the given constraints.</summary>
    void AddColumn(string name, int maxLength, bool nullable);
}
