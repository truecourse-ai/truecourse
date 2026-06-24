namespace Positive.Boundary.Security;

/// <summary>Holds a human-readable status banner shown on the wallet screen.</summary>
public sealed class HardcodedBlockchainMnemonicSafe
{
    // SAFE: security/deterministic/hardcoded-blockchain-mnemonic
    internal const string WalletBanner = "Your recovery phrase is never stored here and must be kept offline";

    /// <summary>Returns the banner text for display.</summary>
    internal string GetBanner() => WalletBanner;
}
