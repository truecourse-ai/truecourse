namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A custom exception that derives from <c>Exception</c> and is correctly named
/// with the <c>Exception</c> suffix (CA1710) rather than a Java/JS-style
/// <c>Error</c> suffix, so the rule must not fire.
/// </summary>
// SAFE: code-quality/deterministic/error-instead-of-exception
public sealed class ErrorInsteadOfExceptionSafeException : System.Exception
{
    /// <summary>Creates the exception with no message.</summary>
    public ErrorInsteadOfExceptionSafeException()
    {
    }

    /// <summary>Creates the exception with a descriptive message.</summary>
    public ErrorInsteadOfExceptionSafeException(string message)
        : base(message)
    {
    }

    /// <summary>Creates the exception wrapping an inner cause.</summary>
    public ErrorInsteadOfExceptionSafeException(string message, System.Exception innerException)
        : base(message, innerException)
    {
    }
}

/// <summary>Guards a numeric input, throwing the correctly-suffixed exception.</summary>
public sealed class ErrorInsteadOfExceptionSafe
{
    private int _checks;

    /// <summary>Throws when the value is negative; returns it otherwise.</summary>
    public int Require(int value)
    {
        _checks += 1;
        if (value < 0)
        {
            throw new ErrorInsteadOfExceptionSafeException("value must be non-negative");
        }

        return value;
    }
}
