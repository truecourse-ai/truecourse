using System.Data;
using System.Globalization;
using System.IO;

namespace Positive.Boundary.Security;

/// <summary>Loads XML into a strongly-typed DataSet whose schema is fixed before reading.</summary>
public sealed class DatasetReadxmlUntrustedSafe
{
    /// <summary>Reads the body into a schema-locked DataSet so no types are inferred.</summary>
    internal DataSet LoadOrders(string xmlBody, string schemaPath)
    {
        var orders = new DataSet { Locale = CultureInfo.InvariantCulture };
        orders.ReadXmlSchema(schemaPath);
        // SAFE: security/deterministic/dataset-readxml-untrusted
        orders.ReadXml(new StringReader(xmlBody), XmlReadMode.IgnoreSchema);
        return orders;
    }
}
