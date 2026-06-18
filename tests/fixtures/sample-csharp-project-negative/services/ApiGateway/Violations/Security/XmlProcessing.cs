using System.Security.Cryptography.Xml;
using System.Xml;

namespace ApiGateway.Violations.Security;

internal sealed class XmlProcessing
{
    internal XmlReaderSettings BuildReaderSettings()
    {
        var settings = new XmlReaderSettings();
        // VIOLATION: security/deterministic/xml-xxe
        settings.DtdProcessing = DtdProcessing.Parse;
        return settings;
    }

    internal bool VerifySignature(SignedXml signedXml)
    {
        // VIOLATION: security/deterministic/unsafe-xml-signature
        return signedXml.CheckSignature();
    }
}
