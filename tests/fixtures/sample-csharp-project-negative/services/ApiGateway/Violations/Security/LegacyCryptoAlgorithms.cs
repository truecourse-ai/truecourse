using System.Security.Cryptography;
using System.Xml.Xsl;

namespace ApiGateway.Violations.Security;

internal sealed class LegacyCryptoAlgorithms
{
    internal DSA CreateSignatureAlgorithm()
    {
        // VIOLATION: security/deterministic/use-of-dsa
        return DSA.Create();
    }

    internal XslTransform CreateLegacyTransform()
    {
        // VIOLATION: security/deterministic/use-of-xsltransform
        return new XslTransform();
    }
}
