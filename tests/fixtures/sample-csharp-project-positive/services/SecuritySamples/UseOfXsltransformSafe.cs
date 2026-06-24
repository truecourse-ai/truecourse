using System.Xml.Xsl;

namespace Positive.Boundary.Security;

/// <summary>Builds XSLT processors using the supported transform type.</summary>
public sealed class UseOfXsltransformSafe
{
    /// <summary>Returns a compiled-transform processor with scripts disabled by default.</summary>
    // SAFE: security/deterministic/use-of-xsltransform
    internal XslCompiledTransform CreateTransform() => new XslCompiledTransform();
}
