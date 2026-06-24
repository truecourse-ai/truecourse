using Lextm.SharpSnmpLib.Security;

namespace Positive.Boundary.Security;

/// <summary>Builds SNMPv3 privacy/auth providers using strong algorithms.</summary>
public sealed class SnmpWeakCryptoSafe
{
    /// <summary>Returns an AES privacy provider keyed by a SHA-256 auth provider.</summary>
    internal IPrivacyProvider BuildPrivacy(OctetString authPhrase, OctetString privacyPhrase)
    {
        var auth = new SHA256AuthenticationProvider(authPhrase);
        // SAFE: security/deterministic/snmp-weak-crypto
        return new AESPrivacyProvider(privacyPhrase, auth);
    }
}
