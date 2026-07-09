namespace Positive.Boundary.CodeQuality;

/// <summary>Read-only metadata contract implemented explicitly below.</summary>
public interface IMetadataView
{
    string PrimaryKey { get; }
    string this[int index] { get; }
}

/// <summary>
/// Implements <see cref="IMetadataView"/> explicitly. C# forbids an access modifier
/// on an explicit interface member (adding one is a compile error), so
/// missing-access-modifier must not fire on the property or the indexer.
/// </summary>
// SAFE: code-quality/deterministic/missing-access-modifier
public sealed class ExplicitInterfaceMembersSafe : IMetadataView
{
    string IMetadataView.PrimaryKey => "id";

    string IMetadataView.this[int index] => index == 0 ? "id" : "name";
}
