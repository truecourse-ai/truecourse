using System.Runtime.Serialization;

namespace Positive.Boundary.Bugs;

/// <summary>Versioned payload whose optional field is initialized on deserialization.</summary>
[DataContract]
public sealed class OptionalfieldMissingDeserializationHandlerSafe
{
    [DataMember]
    private int _timeoutSeconds;

    [OptionalField]
    private bool _verbose;

    /// <summary>The configured timeout in seconds.</summary>
    public int Timeout => _timeoutSeconds;

    /// <summary>Whether verbose logging is enabled.</summary>
    public bool Verbose => _verbose;

    // SAFE: bugs/deterministic/optionalfield-missing-deserialization-handler
    [OnDeserialized]
    private void AfterDeserialize(StreamingContext context)
    {
        _verbose = context.State == StreamingContextStates.All;
    }
}
