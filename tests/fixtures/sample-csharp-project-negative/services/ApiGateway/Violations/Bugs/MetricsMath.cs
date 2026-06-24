using System;
using System.Collections.Generic;
using System.Linq;

namespace ApiGateway.Violations.Bugs;

// Aggregates request metrics with arithmetic that is subtly wrong: signed-modulus
// parity tests, eager boolean operators that always evaluate the right side, a
// Buffer.BlockCopy whose count is an element length not a byte length, an unchecked
// Enumerable.Sum that can overflow silently, and delegate subtraction.
internal sealed class MetricsMath
{
    internal bool IsOddSample(int index)
    {
        // For negative index, index % 2 is -1, so == 1 is wrong; use == 0 / != 0.
        // VIOLATION: bugs/deterministic/modulus-direct-equality
        return index % 2 == 1;
    }

    internal bool ShouldRecord(bool enabled, IReadOnlyList<int> samples)
    {
        // Eager '&' always evaluates HasOutliers() even when sampling is disabled.
        // VIOLATION: bugs/deterministic/non-short-circuit-boolean
        return enabled & HasOutliers(samples);
    }

    private static bool HasOutliers(IReadOnlyList<int> samples) => samples.Count > 100;

    internal void CopyCounters(int[] source, int[] destination)
    {
        // BlockCopy counts BYTES; passing the element Length copies a quarter of the data.
        // VIOLATION: bugs/deterministic/blockcopy-wrong-count
        Buffer.BlockCopy(source, 0, destination, 0, source.Length);
    }

    internal int TotalLatency(List<int> latencies)
    {
        // Sum in an unchecked context wraps around on overflow instead of throwing.
        // VIOLATION: bugs/deterministic/unchecked-enumerable-sum-overflow
        unchecked
        {
            // VIOLATION: bugs/deterministic/unchecked-enumerable-sum-overflow
            return latencies.Sum();
        }
    }

    internal Action Detach(Action all, Action one)
    {
        // Delegate subtraction has surprising multicast-removal semantics.
        // VIOLATION: bugs/deterministic/delegate-subtraction
        return all - one;
    }
}
