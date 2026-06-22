using System;
using System.Runtime.Serialization;

namespace ApiGateway.Violations.Bugs;

// A serializable session snapshot. It implements ISerializable but is missing the
// (SerializationInfo, StreamingContext) deserialization constructor, so round-tripping
// throws at runtime.
[Serializable]
// VIOLATION: bugs/deterministic/iserializable-incorrect
internal sealed class SessionSnapshot : ISerializable
{
    private readonly string _id;

    internal SessionSnapshot(string id)
    {
        _id = id;
    }

    /// <summary>Serializes the snapshot's identity.</summary>
    // VIOLATION: code-quality/deterministic/unused-function-parameter
    public void GetObjectData(SerializationInfo info, StreamingContext context)
    {
        info.AddValue("id", _id);
    }
}

// A versioned settings payload. A field added in v2 carries [OptionalField] but there
// is no [OnDeserialized] handler to initialize it, so old payloads leave it at default.
[DataContract]
// VIOLATION: bugs/deterministic/optionalfield-missing-deserialization-handler
internal sealed class SettingsPayload
{
    [DataMember]
    private int _timeoutSeconds;

    [OptionalField]
    private bool _verbose;

    internal int Timeout => _timeoutSeconds == 0 ? 30 : _timeoutSeconds;

    internal bool Verbose => _verbose;
}

// A serializable cache entry whose [OnDeserialized] callback has the wrong signature:
// a serialization callback must be non-static, return void, and take exactly one
// StreamingContext parameter — this one takes none.
[DataContract]
internal sealed class CacheEntry
{
    [DataMember]
    private string _key;

    internal string Key => _key;

    // VIOLATION: bugs/deterministic/serialization-handler-wrong-signature
    [OnDeserialized]
    private void AfterLoad()
    {
        _key ??= string.Empty;
    }
}
