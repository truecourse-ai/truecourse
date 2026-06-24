using System;

namespace Positive.Boundary.Bugs;

/// <summary>Processes batches by reusing a single stack buffer.</summary>
public sealed class StackallocInLoopSafe
{
    private const int BufferSize = 1024;

    /// <summary>Clears and fills a scratch buffer once per batch, reusing one allocation.</summary>
    internal void Process(int batches)
    {
        // SAFE: bugs/deterministic/stackalloc-in-loop
        Span<byte> scratch = stackalloc byte[BufferSize];
        for (var i = 0; i < batches; i++)
        {
            Fill(scratch);
        }
    }

    private static void Fill(Span<byte> buffer)
    {
        buffer.Clear();
    }
}
