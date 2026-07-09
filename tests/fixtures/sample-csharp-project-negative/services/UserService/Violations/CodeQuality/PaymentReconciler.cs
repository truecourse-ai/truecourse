namespace UserServiceApp.Violations.CodeQuality;

/// <summary>Settles pending payment batches.</summary>
internal sealed class PaymentReconciler
{
    /// <summary>Should settle the pending batch, but the body was left empty by mistake.</summary>
    // VIOLATION: code-quality/deterministic/empty-function
    // VIOLATION: code-quality/deterministic/no-empty-function
    internal void SettleBatch()
    {
    }
}
