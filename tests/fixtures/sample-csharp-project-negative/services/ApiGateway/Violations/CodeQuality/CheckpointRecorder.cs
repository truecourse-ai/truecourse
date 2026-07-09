using System;

namespace ApiGateway.Violations.CodeQuality;

/// <summary>Records processing checkpoints using the ambient clock read directly.</summary>
internal sealed class CheckpointRecorder
{
    private DateTime _lastCheckpoint;

    /// <summary>Advances the checkpoint to the current wall-clock time.</summary>
    internal void Advance()
    {
        // Reads the ambient clock directly instead of an injected abstraction,
        // making the checkpoint non-deterministic to test.
        // VIOLATION: code-quality/deterministic/non-testable-datetime-provider
        _lastCheckpoint = DateTime.Now;
    }

    /// <summary>The most recent checkpoint instant.</summary>
    internal DateTime Last => _lastCheckpoint;
}
