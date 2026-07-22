namespace Positive.Boundary.Architecture;

/// <summary>Base type for a content-model field.</summary>
public class ContentField { }

/// <summary>
/// A content-model field whose link is user-entered: routinely relative
/// (<c>~/page</c>), an anchor (<c>#section</c>) or <c>mailto:</c> — none valid as an
/// absolute <see cref="System.Uri"/>. The property is a string by the framework's
/// contract, so uri-property-as-string must not fire on a content-model type.
/// </summary>
public sealed class BookmarkFieldSafe : ContentField
{
    // SAFE: architecture/deterministic/uri-property-as-string
    public string Url { get; set; }

    // SAFE: architecture/deterministic/uri-property-as-string
    public string PreviewUrl { get; set; }
}
