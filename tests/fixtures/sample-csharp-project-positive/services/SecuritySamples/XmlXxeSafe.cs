using System.Xml;

namespace Positive.Boundary.Security;

/// <summary>Builds XML reader settings that block DTD processing.</summary>
public sealed class XmlXxeSafe
{
    /// <summary>Returns reader settings with DTD processing prohibited.</summary>
    internal XmlReaderSettings BuildReaderSettings()
    {
        var settings = new XmlReaderSettings();
        // SAFE: security/deterministic/xml-xxe
        settings.DtdProcessing = DtdProcessing.Prohibit;
        return settings;
    }
}
