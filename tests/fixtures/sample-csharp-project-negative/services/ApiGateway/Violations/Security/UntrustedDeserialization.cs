using System.Data;
using System.IO;
using System.Xml.Schema;
using System.Xml.Xsl;

namespace ApiGateway.Violations.Security;

internal sealed class UntrustedDeserialization
{
    internal DataSet LoadDataSet(string xml)
    {
        // VIOLATION: code-quality/deterministic/locale-not-set
        var dataSet = new DataSet();
        // VIOLATION: security/deterministic/dataset-readxml-untrusted
        dataSet.ReadXml(new StringReader(xml));
        return dataSet;
    }

    internal DataTable LoadDataTable(string xml)
    {
        // VIOLATION: code-quality/deterministic/locale-not-set
        var dataTable = new DataTable();
        // VIOLATION: security/deterministic/datatable-readxml-untrusted
        dataTable.ReadXml(new StringReader(xml));
        return dataTable;
    }

    internal XsltSettings BuildTransformSettings()
    {
        // VIOLATION: security/deterministic/insecure-xslt-script
        return new XsltSettings(enableDocumentFunction: false, enableScript: true);
    }

    internal void RegisterSchema(XmlSchemaSet schemas)
    {
        // VIOLATION: security/deterministic/xmlschema-add-by-url
        schemas.Add("urn:orders", "https://schemas.example.com/orders.xsd");
    }
}
