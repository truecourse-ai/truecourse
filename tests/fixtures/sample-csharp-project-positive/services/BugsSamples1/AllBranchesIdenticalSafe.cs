using System.Collections.Generic;

namespace Positive.Boundary.Bugs;

/// <summary>Routes invoices to the queue that matches their state.</summary>
public sealed class AllBranchesIdenticalSafe
{
    /// <summary>Adds the invoice to the archive or the active queue depending on state.</summary>
    internal void ArchiveInvoice(string invoiceId, bool isArchived, List<string> archive, List<string> active)
    {
        // SAFE: bugs/deterministic/all-branches-identical
        if (isArchived)
        {
            archive.Add(invoiceId);
        }
        else
        {
            active.Add(invoiceId);
        }
    }
}
