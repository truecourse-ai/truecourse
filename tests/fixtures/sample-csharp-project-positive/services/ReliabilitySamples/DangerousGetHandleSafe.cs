using System.Runtime.InteropServices;

namespace Positive.Boundary.Reliability;

/// <summary>Reads from a SafeHandle without extracting the raw OS handle.</summary>
public sealed class DangerousGetHandleSafe
{
    /// <summary>True when the handle was pinned and released without leaking.</summary>
    internal bool Touch(SafeHandle handle)
    {
        var added = false;
        try
        {
            // SAFE: reliability/deterministic/dangerous-get-handle
            handle.DangerousAddRef(ref added);
            return !handle.IsInvalid;
        }
        finally
        {
            if (added)
            {
                handle.DangerousRelease();
            }
        }
    }
}
