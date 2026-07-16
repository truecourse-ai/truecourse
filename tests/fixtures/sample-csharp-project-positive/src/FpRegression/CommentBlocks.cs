namespace Demo.Http;

/// <summary>
/// Multi-line `//` notes that use a blank `//` line as a paragraph separator
/// inside a single comment block. The blank `//` keeps the block visually
/// contiguous between paragraphs — deliberate formatting, not empty-comment
/// noise, so it must not be flagged.
/// </summary>
internal sealed class CommentBlocks
{
    // Default sweep interval of ten seconds is a reasonable balance.
    // Rough sizing, in words:
    // about ten tracked keys, each living at least a second, means a sweep
    // queue of roughly a hundred items.
    //
    // Frequent enough in practice, and we also lean on the collector to
    // reclaim entries in the background.
    public int SweepSeconds { get; } = 10;

    // A fresh timer is used for each sweep cycle, guarded by a lock. Nothing
    // here needs disposing because the timer is started and stopped on demand.
    //
    // The type itself need not be disposable; once nothing references it, the
    // runtime reclaims it like any other object.
    public bool Reclaimable { get; } = true;
}
