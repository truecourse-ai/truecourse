namespace UserServiceApp.Violations.CodeQuality;

// VIOLATION: code-quality/deterministic/filename-class-mismatch
// VIOLATION: code-quality/deterministic/csharp-filename-type-mismatch
public class PaymentRelay
{
    private readonly List<string> _relayed = new List<string>();

    internal void Relay(string paymentId)
    {
        _relayed.Add(paymentId);
    }

    internal int RelayedCount()
    {
        return _relayed.Count;
    }
}
