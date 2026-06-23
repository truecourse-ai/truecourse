using System.Security.Cryptography;
using System.Text;

namespace Positive.Boundary.Security;

/// <summary>Compares HMAC signatures in constant time.</summary>
public sealed class TimingAttackComparisonSafe
{
    /// <summary>Returns true when the two signatures match without leaking timing.</summary>
    internal bool SignaturesMatch(string providedSignature, string expectedSignature)
    {
        var provided = Encoding.UTF8.GetBytes(providedSignature);
        var expected = Encoding.UTF8.GetBytes(expectedSignature);
        // SAFE: security/deterministic/timing-attack-comparison
        return CryptographicOperations.FixedTimeEquals(provided, expected);
    }
}
