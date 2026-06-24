namespace ApiGateway.Violations.Style;

/// <summary>Wires a transform using an unescaped reserved lambda parameter.</summary>
internal sealed class PipelineStage
{
    private readonly List<Func<int, int>> _stages = new();

    internal void Add()
    {
        // VIOLATION: style/deterministic/scoped-identifier-escape
        _stages.Add((scoped) => scoped + 1);
    }
}
