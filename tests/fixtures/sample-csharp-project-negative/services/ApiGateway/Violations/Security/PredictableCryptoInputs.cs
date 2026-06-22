using System.Security.Cryptography;
using Org.BouncyCastle.Security;

namespace ApiGateway.Violations.Security;

internal sealed class PredictableCryptoInputs
{
    internal void UseZeroIv(Aes aes)
    {
        // VIOLATION: security/deterministic/predictable-cipher-iv
        aes.IV = new byte[16];
    }

    internal SecureRandom CreateSeededGenerator()
    {
        var random = new SecureRandom();
        // VIOLATION: performance/deterministic/constant-array-argument
        // VIOLATION: security/deterministic/predictable-random-seed
        random.SetSeed(new byte[] { 0x10, 0x20, 0x30, 0x40 });
        return random;
    }
}
