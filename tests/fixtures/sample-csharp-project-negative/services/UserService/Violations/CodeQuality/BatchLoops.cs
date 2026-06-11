namespace UserServiceApp.Violations.CodeQuality;

internal class CartItem
{
    public bool IsBlocked { get; set; }
    public bool IsPrimary { get; set; }
    public int Quantity { get; set; }
}

internal class BatchLoops
{
    internal int SumQuantities(List<CartItem> lines)
    {
        var total = 0;
        // VIOLATION: code-quality/deterministic/indexed-loop-over-for-of
        for (int i = 0; i < lines.Count; i++)
        {
            total += lines[i].Quantity;
        }
        return total;
    }

    internal string DrainCursor(string cursor)
    {
        var remaining = cursor;
        // VIOLATION: code-quality/deterministic/prefer-while
        for (; remaining.Length > 0;)
        {
            remaining = TrimCursor(remaining);
        }
        return remaining;
    }

    // VIOLATION: code-quality/deterministic/reimplemented-builtin
    internal bool HasBlockedItem(List<CartItem> items)
    {
        foreach (var item in items)
        {
            if (item.IsBlocked)
            {
                return true;
            }
        }
        return false;
    }

    internal CartItem PickPrimaryItem(List<CartItem> contacts)
    {
        // VIOLATION: code-quality/deterministic/filter-first-over-find
        return contacts.Where(c => c.IsPrimary).First();
    }

    internal bool ReplaySteps(int budget)
    {
        var moved = true;
        // VIOLATION: code-quality/deterministic/equals-in-for-termination
        for (var step = 0; moved = TryAdvance(step, budget); step++)
        {
            RecordStep(step);
        }
        return moved;
    }

    internal string TallyLines(List<CartItem> lines, bool isVoid, bool isTaxable)
    {
        var skipped = 0;
        var taxable = 0;
        // VIOLATION: code-quality/deterministic/misleading-same-line-conditional
        if (isVoid) skipped++; if (isTaxable) taxable++;
        return $"{skipped} skipped, {taxable} taxable, {lines.Count} total";
    }

    internal int QueueRetries(List<CartItem> entries)
    {
        var retries = 0;
        foreach (var entry in entries)
        {
            // VIOLATION: code-quality/deterministic/multiline-block-without-braces
            if (entry.IsBlocked)
                retries++;
                RecordStep(retries);
        }
        return retries;
    }

    internal void FlushBatch(List<string> batch)
    {
        if (batch.Count == 0)
        {
            return;
        }
        PublishBatch(batch);
        // VIOLATION: code-quality/deterministic/redundant-jump
        return;
    }

    internal int DrainWithRetry(Queue<string> channel)
    {
        var attempts = 0;
    retry:
        attempts++;
        if (channel.Count > 0 && attempts < 2)
        {
            channel.Dequeue();
            // VIOLATION: code-quality/deterministic/labels-usage
            goto retry;
        }
        return attempts;
    }

    internal void RebuildIndexes(List<string> names)
    {
        // VIOLATION: code-quality/deterministic/unnecessary-block
        {
            names.Sort();
        }
        names.Reverse();
    }

    internal string TrimCursor(string cursor)
    {
        return cursor.Substring(1);
    }

    internal bool TryAdvance(int step, int budget)
    {
        return step < budget;
    }

    internal void RecordStep(int step)
    {
        _steps.Add(step);
    }

    internal void PublishBatch(List<string> batch)
    {
        _published += batch.Count;
    }

    private readonly List<int> _steps = new List<int>();
    private int _published;
}
