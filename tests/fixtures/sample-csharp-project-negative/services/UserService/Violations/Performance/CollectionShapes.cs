using System;
using System.Collections.Generic;

namespace UserServiceApp.Violations.Performance;

internal sealed class CollectionShapes
{
    internal int[] EmptyBatch()
    {
        // VIOLATION: performance/deterministic/zero-length-array-allocation
        return new int[0];
    }

    // VIOLATION: performance/deterministic/multidimensional-array
    internal int CellAt(int[,] grid, int row, int column)
    {
        return grid[row, column];
    }

    internal void Register(Dictionary<string, int> map, string key, int value)
    {
        // VIOLATION: performance/deterministic/prefer-tryadd
        if (!map.ContainsKey(key))
            map.Add(key, value);
    }

    internal void Evict(Dictionary<string, int> map, string key)
    {
        // VIOLATION: performance/deterministic/redundant-containskey-before-remove
        if (map.ContainsKey(key))
            map.Remove(key);
    }
}
