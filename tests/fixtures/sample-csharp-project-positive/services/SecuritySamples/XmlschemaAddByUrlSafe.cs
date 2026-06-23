using System.Xml;
using System.Xml.Schema;

namespace Positive.Boundary.Security;

/// <summary>Registers an XML schema from a trusted in-memory reader.</summary>
public sealed class XmlschemaAddByUrlSafe
{
    /// <summary>Adds a schema to the set using a local reader rather than a URL.</summary>
    internal void RegisterSchema(XmlSchemaSet schemas, XmlReader schemaReader)
    {
        // SAFE: security/deterministic/xmlschema-add-by-url
        schemas.Add("urn:orders", schemaReader);
    }
}
