using Org.BouncyCastle.Security;

namespace Positive.Boundary.Security;

/// <summary>Builds a secure RNG that self-seeds from the OS entropy source.</summary>
public sealed class PredictableRandomSeedSafe
{
    /// <summary>Returns a CSPRNG seeded with fresh entropy rather than a constant.</summary>
    internal SecureRandom CreateGenerator(byte[] entropy)
    {
        var random = new SecureRandom();
        // SAFE: security/deterministic/predictable-random-seed
        random.SetSeed(entropy);
        return random;
    }
}
