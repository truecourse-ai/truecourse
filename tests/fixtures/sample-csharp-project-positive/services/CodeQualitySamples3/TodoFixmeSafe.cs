namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A class with an ordinary explanatory comment that contains no standalone
/// task-marker word, so the todo-fixme rule must not fire.
/// </summary>
public class TodoFixmeSafe
{
    /// <summary>Returns the next sequence value for the given seed.</summary>
    internal int Next(int seed)
    {
        // SAFE: code-quality/deterministic/todo-fixme
        // Methodology note: the offset keeps the sequence monotonic.
        return seed + 1;
    }
}
