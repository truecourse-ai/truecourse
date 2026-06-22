using System.Diagnostics;
using System.Threading.Tasks;

namespace ApiGateway.Violations.Bugs;

// A partial pipeline type that declares a partial hook never implemented anywhere, and
// a DebuggerDisplay that references a member the type does not have.
// VIOLATION: bugs/deterministic/debuggerdisplay-invalid-member
[DebuggerDisplay("{Endpoint}")]
internal partial class RequestPipeline
{
    private int _stage;

    internal int Stage => _stage;

    // Declared but never implemented in any partial part — the call compiles to a no-op.
    // VIOLATION: bugs/deterministic/partial-method-not-implemented
    // VIOLATION: code-quality/deterministic/partial-element-missing-access-modifier
    partial void OnStageAdvanced();

    internal void Advance()
    {
        _stage++;
        OnStageAdvanced();
    }
}

// Builds a TaskCompletionSource but passes TaskContinuationOptions where the constructor
// expects TaskCreationOptions — the flags are silently misinterpreted.
internal sealed class DeferredResult
{
    internal Task<int> Pending()
    {
        // VIOLATION: bugs/deterministic/taskcompletionsource-wrong-options
        var tcs = new TaskCompletionSource<int>(TaskContinuationOptions.LongRunning);
        return tcs.Task;
    }
}
