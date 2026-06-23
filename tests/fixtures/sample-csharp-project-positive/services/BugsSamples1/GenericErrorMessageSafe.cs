namespace Positive.Boundary.Bugs;

/// <summary>Produces specific, actionable error messages with codes.</summary>
public sealed class GenericErrorMessageSafe
{
    /// <summary>Returns the failure message for a rejected batch.</summary>
    internal string DescribeBatchFailure(int batchSize)
    {
        // SAFE: bugs/deterministic/generic-error-message
        return $"E1042: batch of size {batchSize} exceeds the allowed limit";
    }
}
