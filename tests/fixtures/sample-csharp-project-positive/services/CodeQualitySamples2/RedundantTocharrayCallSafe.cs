namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Iterates a substring copied with the two-argument <c>ToCharArray(start,
/// length)</c> overload, which genuinely allocates only the requested slice.
/// The redundant-ToCharArray rule must not fire — only the parameterless
/// overload is redundant.
/// </summary>
public class RedundantTocharrayCallSafe
{
    /// <summary>Counts the letter <c>a</c> in the tail of <paramref name="word"/>.</summary>
    public int CountTailAs(string word)
    {
        var count = 0;
        // SAFE: code-quality/deterministic/redundant-tochararray-call
        foreach (var c in word.ToCharArray(1, word.Length - 1))
        {
            if (c == 'a')
            {
                count += 1;
            }
        }

        return count;
    }
}
