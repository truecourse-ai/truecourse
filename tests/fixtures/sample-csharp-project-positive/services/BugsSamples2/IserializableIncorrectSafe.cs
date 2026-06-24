using System.Runtime.Serialization;

namespace Positive.Boundary.Bugs;

/// <summary>A snapshot that implements ISerializable correctly, with both required members.</summary>
public sealed class IserializableIncorrectSafe : ISerializable
{
    private readonly string _id;

    /// <summary>Creates a snapshot from an identifier.</summary>
    public IserializableIncorrectSafe(string id)
    {
        _id = id;
    }

    // SAFE: bugs/deterministic/iserializable-incorrect
    private IserializableIncorrectSafe(SerializationInfo info, StreamingContext _context)
    {
        _id = info.GetString(nameof(_id)) ?? string.Empty;
    }

    /// <summary>Writes the snapshot's state into the serialization info.</summary>
    public void GetObjectData(SerializationInfo info, StreamingContext context)
    {
        _ = context.State;
        info.AddValue(nameof(_id), _id);
    }

    /// <summary>Returns the stored identifier.</summary>
    internal string Id => _id;
}
