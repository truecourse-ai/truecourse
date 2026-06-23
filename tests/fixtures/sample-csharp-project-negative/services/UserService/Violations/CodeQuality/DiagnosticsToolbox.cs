using System.Diagnostics;
using System.Text;

namespace UserServiceApp.Violations.CodeQuality;

internal class DiagnosticsToolbox
{
    private int _flushCount;

    internal void PauseForInspection()
    {
        // VIOLATION: code-quality/deterministic/no-debugger
        Debugger.Break();
    }

    internal string FetchLegacyExport(string target)
    {
        // VIOLATION: code-quality/deterministic/in-source-suppression
        // VIOLATION: code-quality/deterministic/ban-ts-comment

#pragma warning disable CS0618
        // VIOLATION: code-quality/deterministic/deprecated-api-usage
        var request = WebRequest.Create(target);
#pragma warning restore CS0618
        return request.Method;
    }

    internal string BuildSummary(List<string> rows)
    {
        // VIOLATION: code-quality/deterministic/unnecessary-namespace-qualifier
        // VIOLATION: code-quality/deterministic/verbose-declaration-initialization
        StringBuilder builder = new System.Text.StringBuilder();
        foreach (var row in rows)
        {
            builder.AppendLine(row);
        }
        // VIOLATION: code-quality/deterministic/todo-fixme
        // TODO: replace the legacy export with the streaming pipeline
        return builder.ToString();
    }

    internal int CountArchiveRows(List<string> rows)
    {
        // VIOLATION: code-quality/deterministic/commented-out-code
        // var legacyExport = BuildLegacyExport(rows);
        return rows.Count;
    }

    internal string DescribeResponse(int code)
    {
        // VIOLATION: code-quality/deterministic/ambiguous-unicode-character
        // VIOLATION: bugs/deterministic/missing-format-provider-overload
        var statuѕLabel = code.ToString();
        return $"status {statuѕLabel}";
    }

    internal string ReadManifestVersion(string raw)
    {
        // VIOLATION: code-quality/deterministic/unsafe-any-usage
        dynamic manifest = DecodePayload(raw);
        return manifest.Version;
    }

    internal string ResolveZoneLabel(string zone)
    {
        // VIOLATION: code-quality/deterministic/non-null-assertion
        var label = LookupZone(zone)!.Trim();
        return label.ToUpperInvariant();
    }

    internal string ReadManifestHeader(string manifestPath)
    {
        // VIOLATION: code-quality/deterministic/open-file-without-context-manager
        var reader = new StreamReader(manifestPath);
        var headerLine = reader.ReadLine();
        return headerLine ?? string.Empty;
    }

    internal void RecordFlush()
    {
        // VIOLATION: code-quality/deterministic/useless-with-lock
        lock (new object())
        {
            _flushCount++;
        }
    }

    internal int FlushesRecorded()
    {
        return _flushCount;
    }

    internal string DecodePayload(string raw)
    {
        return raw;
    }

    internal string? LookupZone(string zone)
    {
        return zone.Length > 0 ? zone : null;
    }

    internal Assembly LoadDiagnostics(string path)
    {
        _flushCount++;
        // VIOLATION: code-quality/deterministic/prefer-assembly-load
        return Assembly.LoadFrom(path);
    }

    internal void NarrateFlush()
    {
        _logger.LogInformation("flush 1");
        _logger.LogInformation("flush 2");
        _logger.LogInformation("flush 3");
        _logger.LogInformation("flush 4");
        _logger.LogInformation("flush 5");
        _logger.LogInformation("flush 6");
        _logger.LogInformation("flush 7");
        // VIOLATION: code-quality/deterministic/too-many-logging-calls
        _logger.LogInformation("flush 8");
    }

    private readonly ILogger _logger = null!;

    internal int SumWithoutPointers(int seed)
    {
        // VIOLATION: code-quality/deterministic/unnecessary-unsafe-context
        // VIOLATION: security/deterministic/unsafe-code-block
        unsafe
        {
            var total = seed;
            total += _flushCount;
            return total;
        }
    }

    internal static class TextExtensions
    {
        // VIOLATION: code-quality/deterministic/extension-method-on-object
        public static string Dump(this object value)
        {
            return value?.ToString() ?? string.Empty;
        }
    }
}
