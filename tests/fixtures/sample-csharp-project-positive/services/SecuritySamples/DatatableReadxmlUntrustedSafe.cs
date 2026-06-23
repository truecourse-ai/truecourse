using System.Data;
using System.Globalization;
using System.IO;

namespace Positive.Boundary.Security;

/// <summary>Loads XML into a DataTable whose schema is fixed before any data is read.</summary>
public sealed class DatatableReadxmlUntrustedSafe
{
    /// <summary>Reads the body into a schema-locked table so no types are inferred.</summary>
    internal DataTable LoadEntries(string xmlBody, string schemaPath)
    {
        var entries = new DataTable { Locale = CultureInfo.InvariantCulture };
        entries.ReadXmlSchema(schemaPath);
        // SAFE: security/deterministic/datatable-readxml-untrusted
        entries.ReadXml(new StringReader(xmlBody), XmlReadMode.IgnoreSchema);
        return entries;
    }
}
