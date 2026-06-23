using System;

namespace Positive.Boundary.Bugs;

/// <summary>A getter that signals an invalid object state with the allowed exception type.</summary>
public sealed class ExceptionFromPropertyGetterSafe
{
    private bool _initialized;
    private int _value;

    /// <summary>Marks the instance ready and stores its value.</summary>
    public void Initialize(int value)
    {
        _value = value;
        _initialized = true;
    }

    /// <summary>The stored value; throws if read before initialization.</summary>
    public int Value
    {
        get
        {
            // SAFE: bugs/deterministic/exception-from-property-getter
            if (!_initialized) throw new InvalidOperationException("Not initialized.");
            return _value;
        }
    }
}
