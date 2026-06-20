using System.Security.Cryptography;

namespace ApiGateway.Violations.Security;

// VIOLATION: security/deterministic/custom-crypto-algorithm
internal sealed class HomegrownDigest : HashAlgorithm
{
    private const uint Prime = 16777619;
    private uint _state;

    public override void Initialize()
    {
        _state = Prime;
    }

    protected override void HashCore(byte[] array, int ibStart, int cbSize)
    {
        foreach (var b in array)
        {
            _state = (_state * Prime) + b;
        }
    }

    protected override byte[] HashFinal()
    {
        return System.BitConverter.GetBytes(_state);
    }
}
