namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A comment whose only doubled token is the allow-listed "that that"
/// construction, which reads correctly in English. The duplicate-word rule
/// must not fire on it.
/// </summary>
public class DuplicateWordInCommentSafe
{
    /// <summary>Returns the supplied value unchanged.</summary>
    internal int Echo(int value)
    {
        // SAFE: code-quality/deterministic/duplicate-word-in-comment
        // The flag indicates that that branch was taken at least once.
        return value;
    }
}
