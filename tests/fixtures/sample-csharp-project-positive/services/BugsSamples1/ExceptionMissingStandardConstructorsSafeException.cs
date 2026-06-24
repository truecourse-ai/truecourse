using System;

namespace Positive.Boundary.Bugs;

/// <summary>A domain exception offering all three conventional constructors.</summary>
// SAFE: bugs/deterministic/exception-missing-standard-constructors
public sealed class ExceptionMissingStandardConstructorsSafeException : Exception
{
    /// <summary>Creates the exception with no message.</summary>
    public ExceptionMissingStandardConstructorsSafeException()
    {
    }

    /// <summary>Creates the exception with a message.</summary>
    public ExceptionMissingStandardConstructorsSafeException(string message)
        : base(message)
    {
    }

    /// <summary>Creates the exception with a message and an inner exception.</summary>
    public ExceptionMissingStandardConstructorsSafeException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
