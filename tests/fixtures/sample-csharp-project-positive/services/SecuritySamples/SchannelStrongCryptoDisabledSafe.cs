using System;

namespace Positive.Boundary.Security;

/// <summary>Keeps Schannel strong crypto enabled for outgoing TLS.</summary>
public sealed class SchannelStrongCryptoDisabledSafe
{
    /// <summary>Explicitly leaves the strong-crypto switch off.</summary>
    internal void KeepSchannelStrongCrypto()
    {
        // SAFE: security/deterministic/schannel-strong-crypto-disabled
        AppContext.SetSwitch("Switch.System.Net.DontEnableSchUseStrongCrypto", false);
    }
}
