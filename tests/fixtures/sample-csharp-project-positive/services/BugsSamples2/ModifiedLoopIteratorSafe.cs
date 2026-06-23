using System.Collections.Generic;
using System.Linq;

namespace Positive.Boundary.Bugs;

/// <summary>Removes dead letters while iterating over a snapshot copy.</summary>
internal sealed class ModifiedLoopIteratorSafe
{
    /// <summary>Removes every entry from the queue by iterating a snapshot first.</summary>
    internal void DrainExpired(List<string> deadLetters)
    {
        // SAFE: bugs/deterministic/modified-loop-iterator
        foreach (var letter in deadLetters.ToList())
        {
            deadLetters.Remove(letter);
        }
    }
}
