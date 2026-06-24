namespace Positive.Boundary.CodeQuality.Model;

/// <summary>A user handle, defined in its own namespace away from its extensions.</summary>
public sealed class UserHandle
{
    /// <summary>Creates a handle from its raw value.</summary>
    public UserHandle(string value)
    {
        Value = value;
    }

    /// <summary>The underlying handle text.</summary>
    public string Value { get; }
}
