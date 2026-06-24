namespace Positive.Boundary.CodeQuality;

/// <summary>Scanner whose loop uses exactly the maximum allowed five break statements.</summary>
public sealed class TooManyBreaksSafe
{
    /// <summary>Returns the index of the first stop marker; five guarded loop breaks is the allowed maximum.</summary>
    internal int FindStop(int[] markers)
    {
        var index = 0;
        while (index < markers.Length)
        {
            var marker = markers[index];
            // SAFE: code-quality/deterministic/too-many-breaks
            if (marker == 0) break;
            if (marker == 1) break;
            if (marker == 2) break;
            if (marker == -1) break;
            if (marker == 100) break;
            index += 1;
        }
        return index;
    }
}
