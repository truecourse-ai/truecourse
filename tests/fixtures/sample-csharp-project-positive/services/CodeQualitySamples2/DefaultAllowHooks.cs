namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Framework "default-allow" policy hooks each have a trivial single-return
/// body (<c>return true;</c>). Being identical is intentional — they are
/// distinct extension points that happen to share a default — and there is
/// nothing worth extracting, so the identical-functions rule must not flag them.
/// </summary>
public class DefaultAllowHooks
{
    /// <summary>Whether reading is allowed by default.</summary>
    public virtual bool CanRead()
    {
        return true;
    }

    /// <summary>Whether writing is allowed by default.</summary>
    public virtual bool CanWrite()
    {
        return true;
    }

    /// <summary>Whether deleting is allowed by default.</summary>
    public virtual bool CanDelete()
    {
        return true;
    }
}
