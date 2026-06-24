namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A static constructor that does real initialization work. The rule only
/// flags a <c>static</c> constructor whose body is empty, so a static
/// constructor with a meaningful body must not fire.
/// </summary>
public sealed class EmptyStaticBlockSafe
{
    private static readonly System.Collections.Generic.List<string> KnownRegions = new();

    /// <summary>Seeds the shared region table once at type load.</summary>
    // SAFE: code-quality/deterministic/empty-static-block
    static EmptyStaticBlockSafe()
    {
        KnownRegions.Add("us-east");
        KnownRegions.Add("eu-west");
    }

    /// <summary>Returns the region resolved during type initialization.</summary>
    public static string Region => KnownRegions[0];
}
