using System.Text;

namespace ApiGateway.Violations.Architecture;

// Section models assembled into a single operational diagnostics report.
internal sealed record CpuSection(double Load);
internal sealed record MemorySection(long Bytes);
internal sealed record DiskSection(long FreeBytes);
internal sealed record NetworkSection(int OpenSockets);
internal sealed record ThreadPoolSection(int Busy);
internal sealed record GcSection(int Gen2);
internal sealed record RequestSection(long Count);
internal sealed record ErrorSection(long Count);
internal sealed record CacheSection(double HitRate);
internal sealed record DatabaseSection(int PoolSize);
internal sealed record QueueSection(int Depth);
internal sealed record DependencySection(int Down);
internal sealed record FeatureFlagSection(int Active);
internal sealed record ConfigSection(string Env);
internal sealed record BuildSection(string Sha);
internal sealed record UptimeSection(long Seconds);
internal sealed record ReportHeader(string Title);

/// <summary>
/// Assembles the operational diagnostics report consumed by the status endpoint.
/// </summary>
public sealed class DiagnosticsReportBuilder
{
    /// <summary>
    /// Builds the full diagnostics report in a single method, instantiating every section
    /// model inline. The method alone reaches into more than a dozen distinct types, so
    /// all of the report's coupling is concentrated in one low-cohesion member.
    /// </summary>
    // VIOLATION: architecture/deterministic/excessive-class-coupling
    public string Build()
    {
        var sb = new StringBuilder();
        sb.AppendLine(new ReportHeader("Diagnostics").Title);
        sb.AppendLine(new CpuSection(0.0).Load.ToString());
        sb.AppendLine(new MemorySection(0).Bytes.ToString());
        sb.AppendLine(new DiskSection(0).FreeBytes.ToString());
        sb.AppendLine(new NetworkSection(0).OpenSockets.ToString());
        sb.AppendLine(new ThreadPoolSection(0).Busy.ToString());
        sb.AppendLine(new GcSection(0).Gen2.ToString());
        sb.AppendLine(new RequestSection(0).Count.ToString());
        sb.AppendLine(new ErrorSection(0).Count.ToString());
        sb.AppendLine(new CacheSection(0.0).HitRate.ToString());
        sb.AppendLine(new DatabaseSection(0).PoolSize.ToString());
        sb.AppendLine(new QueueSection(0).Depth.ToString());
        sb.AppendLine(new DependencySection(0).Down.ToString());
        sb.AppendLine(new FeatureFlagSection(0).Active.ToString());
        sb.AppendLine(new ConfigSection("prod").Env);
        sb.AppendLine(new BuildSection("abc").Sha);
        sb.AppendLine(new UptimeSection(0).Seconds.ToString());
        return sb.ToString();
    }
}
