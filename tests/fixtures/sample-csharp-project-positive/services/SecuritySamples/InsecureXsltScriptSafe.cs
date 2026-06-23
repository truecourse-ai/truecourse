using System.Xml.Xsl;

namespace Positive.Boundary.Security;

/// <summary>Builds XSLT settings with script execution and the document() function disabled.</summary>
public sealed class InsecureXsltScriptSafe
{
    /// <summary>Returns transform settings safe for untrusted stylesheets.</summary>
    internal XsltSettings BuildTransformSettings()
    {
        // SAFE: security/deterministic/insecure-xslt-script
        return new XsltSettings(enableDocumentFunction: false, enableScript: false);
    }
}
