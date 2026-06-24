namespace Positive.Boundary.Style;

internal sealed class CommentTagFormattingSafe
{
    internal int RetryBudget()
    {
        // SAFE: style/deterministic/comment-tag-formatting
        // XXX: revisit the retry budget once the latency metrics land
        return 3;
    }
}
