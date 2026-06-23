using System;

namespace Positive.Boundary.Bugs;

/// <summary>Wraps a percentage; its explicit conversion may reject out-of-range input.</summary>
public readonly struct ExceptionFromUnexpectedMemberSafe
{
    private readonly int _value;

    /// <summary>Creates a percentage from a stored value.</summary>
    public ExceptionFromUnexpectedMemberSafe(int value)
    {
        _value = value;
    }

    /// <summary>The stored percentage value.</summary>
    public int Value => _value;

    /// <summary>Explicit conversions are allowed to throw on invalid input.</summary>
    // SAFE: bugs/deterministic/exception-from-unexpected-member
    public static explicit operator ExceptionFromUnexpectedMemberSafe(int value)
    {
        if (value < 0)
        {
            throw new InvalidOperationException("percentage cannot be negative");
        }

        return new ExceptionFromUnexpectedMemberSafe(value);
    }
}
