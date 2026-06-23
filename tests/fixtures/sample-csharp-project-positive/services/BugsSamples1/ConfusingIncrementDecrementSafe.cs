namespace Positive.Boundary.Bugs;

/// <summary>Copies elements into a buffer using a post-increment index.</summary>
public sealed class ConfusingIncrementDecrementSafe
{
    /// <summary>Fills <paramref name="buffer"/> with the running index value.</summary>
    internal int[] Fill(int[] buffer)
    {
        var pos = 0;
        while (pos < buffer.Length)
        {
            // SAFE: bugs/deterministic/confusing-increment-decrement
            buffer[pos] = pos++;
        }
        return buffer;
    }
}
