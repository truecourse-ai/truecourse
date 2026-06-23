using Microsoft.Azure.WebJobs;

namespace Positive.Boundary.Architecture;

/// <summary>Stateless aggregation Azure Function.</summary>
public class AzureFunctionStatefulSafe
{
    // SAFE: architecture/deterministic/azure-function-stateful
    private const string Prefix = "agg";

    /// <summary>Build a deterministic key from the incoming payload.</summary>
    [FunctionName("Aggregate")]
    public string Run(string payload) => $"{Prefix}:{payload}";
}
