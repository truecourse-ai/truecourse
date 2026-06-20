namespace ApiGateway.Violations.Bugs;

// VIOLATION: bugs/deterministic/recursive-type-inheritance
internal class GraphNode : GraphNode
{
    internal string Label { get; set; } = string.Empty;
}

internal sealed class BufferPipeline
{
    internal void Process(int batches)
    {
        for (var i = 0; i < batches; i++)
        {
            // VIOLATION: bugs/deterministic/stackalloc-in-loop
            Span<byte> scratch = stackalloc byte[1024];
            Fill(scratch);
        }
    }

    private static void Fill(Span<byte> buffer)
    {
        buffer.Clear();
    }
}

internal class NotificationHub
{
    // VIOLATION: bugs/deterministic/virtual-field-like-event
    internal virtual event System.EventHandler? Raised;

    internal void Notify() => Raised?.Invoke(this, System.EventArgs.Empty);
}
