using System.Collections.Generic;

namespace ApiGatewayApp.Violations.CodeQuality;

internal sealed class LoopShapes
{
    private int _ticks;
    private long _sum;

    internal void SpinForever()
    {
        // VIOLATION: code-quality/deterministic/infinite-loop-non-canonical
        for (;;)
        {
            _ticks += 1;
        }
    }

    internal long DrainOnce(List<int> items)
    {
        // VIOLATION: code-quality/deterministic/manual-enumerator-loop
        var enumerator = items.GetEnumerator();
        while (enumerator.MoveNext())
        {
            _sum += enumerator.Current;
        }

        return _sum;
    }
}
