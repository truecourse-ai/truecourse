namespace Positive.Boundary.Bugs;

/// <summary>Adjusts a window using a real compound-assignment operator.</summary>
public sealed class NonExistentOperatorSafe
{
    private int _windowMinutes;

    /// <summary>Returns the current window size in minutes.</summary>
    internal int WindowMinutes => _windowMinutes;

    /// <summary>Reduces the window by the given amount.</summary>
    internal void Reduce(int minutes)
    {
        // SAFE: bugs/deterministic/non-existent-operator
        _windowMinutes -= minutes;
    }
}
