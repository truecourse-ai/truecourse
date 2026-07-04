namespace UserServiceApp.Violations.Architecture;

internal sealed class MetricsCollector
{
    internal string Name => "metrics";

    // VIOLATION: architecture/deterministic/nested-type-publicly-visible
    public sealed class Sample
    {
        public long Value { get; set; }
    }
}
