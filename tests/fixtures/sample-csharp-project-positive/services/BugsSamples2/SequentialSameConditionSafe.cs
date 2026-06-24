namespace Positive.Boundary.Bugs;

/// <summary>Drains a counter with two checks where the first body changes the tested value.</summary>
public sealed class SequentialSameConditionSafe
{
    private int _remaining;

    /// <summary>Resets the counter to the supplied size.</summary>
    internal void Load(int size)
    {
        _remaining = size;
    }

    /// <summary>Consumes the counter in two passes; the first pass mutates it.</summary>
    internal int Drain()
    {
        if (_remaining > 0)
        {
            _remaining--;
        }
        // SAFE: bugs/deterministic/sequential-same-condition
        if (_remaining > 0)
        {
            _remaining--;
        }
        return _remaining;
    }
}
