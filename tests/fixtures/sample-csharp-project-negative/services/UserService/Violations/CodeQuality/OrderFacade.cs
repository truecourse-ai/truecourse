namespace UserServiceApp.Violations.CodeQuality;

internal class OrderCore
{
    public List<string> Log { get; } = new List<string>();
}

// VIOLATION: code-quality/deterministic/too-many-public-methods
internal class OrderFacade
{
    private readonly OrderCore _core;

    public OrderFacade(OrderCore core)
    {
        _core = core;
    }

    /// <summary>Records an order cancellation.</summary>
    public void CancelOrder(string id) => _core.Log.Add($"cancel {id}");

    /// <summary>Records an order hold.</summary>
    public void HoldOrder(string id) => _core.Log.Add($"hold {id}");

    /// <summary>Records an order release.</summary>
    public void ReleaseOrder(string id) => _core.Log.Add($"release {id}");

    /// <summary>Records an address change.</summary>
    public void ChangeAddress(string id) => _core.Log.Add($"address {id}");

    /// <summary>Records a payment retry.</summary>
    public void RetryPayment(string id) => _core.Log.Add($"retry {id}");

    /// <summary>Records a refund request.</summary>
    public void RequestRefund(string id) => _core.Log.Add($"refund {id}");

    /// <summary>Records a partial shipment.</summary>
    public void ShipPartial(string id) => _core.Log.Add($"partial {id}");

    /// <summary>Records a full shipment.</summary>
    public void ShipFull(string id) => _core.Log.Add($"shipped {id}");

    /// <summary>Records a delivery confirmation.</summary>
    public void ConfirmDelivery(string id) => _core.Log.Add($"delivered {id}");

    /// <summary>Records a return authorization.</summary>
    public void AuthorizeReturn(string id) => _core.Log.Add($"return {id}");

    /// <summary>Records a restock event.</summary>
    public void RestockItems(string id) => _core.Log.Add($"restock {id}");

    /// <summary>Records an invoice issue.</summary>
    public void IssueInvoice(string id) => _core.Log.Add($"invoice {id}");

    /// <summary>Records a credit memo.</summary>
    public void IssueCreditMemo(string id) => _core.Log.Add($"credit {id}");

    /// <summary>Records a dispute opening.</summary>
    public void OpenDispute(string id) => _core.Log.Add($"dispute {id}");

    /// <summary>Records a dispute resolution.</summary>
    public void ResolveDispute(string id) => _core.Log.Add($"resolved {id}");

    /// <summary>Records a loyalty accrual.</summary>
    public void AccrueLoyalty(string id) => _core.Log.Add($"loyalty {id}");

    /// <summary>Records a gift wrap request.</summary>
    public void AddGiftWrap(string id) => _core.Log.Add($"giftwrap {id}");

    /// <summary>Records a priority upgrade.</summary>
    public void UpgradePriority(string id) => _core.Log.Add($"priority {id}");

    /// <summary>Records a carrier reassignment.</summary>
    public void ReassignCarrier(string id) => _core.Log.Add($"carrier {id}");

    /// <summary>Records a customs declaration.</summary>
    public void DeclareCustoms(string id) => _core.Log.Add($"customs {id}");

    /// <summary>Records an archive event.</summary>
    public void ArchiveOrder(string id) => _core.Log.Add($"archive {id}");
}
