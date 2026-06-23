namespace Positive.Boundary.Performance;

/// <summary>Reads a cell from a jagged grid.</summary>
public sealed class MultidimensionalArraySafe
{
    /// <summary>Returns one cell of a jagged array, which nests single-dimension specifiers.</summary>
    internal int CellAt(int[][] grid, int row, int column)
    {
        // SAFE: performance/deterministic/multidimensional-array
        return grid[row][column];
    }
}
