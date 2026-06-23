using System.Threading.Tasks;

namespace Positive.Boundary.Bugs;

/// <summary>Constructs a TaskCompletionSource with the correct TaskCreationOptions enum.</summary>
public sealed class TaskcompletionsourceWrongOptionsSafe
{
    /// <summary>Returns a pending task created with the proper run-continuations option.</summary>
    internal Task<int> Pending()
    {
        // SAFE: bugs/deterministic/taskcompletionsource-wrong-options
        var tcs = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
        return tcs.Task;
    }
}
