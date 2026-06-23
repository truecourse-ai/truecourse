using System.Runtime.Serialization;

namespace Positive.Boundary.Bugs;

/// <summary>A contract whose deserialization callback has the exact required signature.</summary>
[DataContract]
public sealed class SerializationHandlerWrongSignatureSafe
{
    [DataMember]
    private string _key = string.Empty;

    /// <summary>The deserialized key.</summary>
    internal string Key => _key;

    // SAFE: bugs/deterministic/serialization-handler-wrong-signature
    [OnDeserialized]
    private void AfterLoad(StreamingContext context)
    {
        _key = string.IsNullOrEmpty(_key) ? context.State.ToString() : _key;
    }
}
