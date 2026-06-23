using System.Security.Cryptography;
using System.Security.Cryptography.Xml;

namespace Positive.Boundary.Security;

/// <summary>Verifies an XML signature against a caller-supplied trusted key.</summary>
public sealed class UnsafeXmlSignatureSafe
{
    /// <summary>Checks the signature using the expected key rather than the embedded one.</summary>
    internal bool VerifySignature(SignedXml signedXml, AsymmetricAlgorithm trustedKey)
    {
        // SAFE: security/deterministic/unsafe-xml-signature
        return signedXml.CheckSignature(trustedKey);
    }
}
