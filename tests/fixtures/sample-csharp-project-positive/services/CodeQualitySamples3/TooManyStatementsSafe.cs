using System.Collections.Generic;

namespace Positive.Boundary.CodeQuality;

/// <summary>Folds a series into a checksum with a statement count that stays at the limit.</summary>
public sealed class TooManyStatementsSafe
{
    /// <summary>Accumulates a rolling checksum over the supplied values.</summary>
    internal int Checksum(IReadOnlyList<int> values)
    {
        var acc = 0;
        var carry = 1;
        // SAFE: code-quality/deterministic/too-many-statements
        for (var i = 0; i < values.Count; i++)
        {
            var v = values[i];
            acc += v; acc += carry; acc += i;
            acc -= 1; acc += v; carry = acc;
            acc += carry; acc += v; acc += i;
            acc -= 1; acc += v; carry = acc;
            acc += carry; acc += v; acc += i;
            acc -= 1; acc += v; carry = acc;
            acc += carry; acc += v; acc += i;
            acc -= 1; acc += v; carry = acc;
            acc += carry; acc += v; acc += i;
            acc -= 1; acc += v; carry = acc;
            acc += carry; acc += v; acc += i;
            acc -= 1; acc += v; carry = acc;
            acc += carry; acc += v; acc += i;
            acc -= 1; acc += v; carry = acc;
            acc += carry; acc += v; acc += i;
        }
        return acc;
    }
}
