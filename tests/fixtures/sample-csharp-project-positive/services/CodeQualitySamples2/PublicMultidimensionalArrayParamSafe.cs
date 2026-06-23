namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A public method that takes a jagged array (<c>T[][]</c>) rather than a
/// rectangular one (<c>T[,]</c>). The rule targets only the comma-rank
/// multidimensional shape, so the public-multidimensional-array-param rule must
/// not fire here.
/// </summary>
public class PublicMultidimensionalArrayParamSafe
{
    /// <summary>Sums every element across the jagged matrix.</summary>
    // SAFE: code-quality/deterministic/public-multidimensional-array-param
    public int Sum(int[][] matrix)
    {
        var total = 0;
        foreach (var row in matrix)
        {
            foreach (var cell in row)
            {
                total += cell;
            }
        }

        return total;
    }
}
