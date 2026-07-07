namespace Microsoft.AspNetCore.Components;

// Minimal stand-in for the Blazor base type, so the fixture can model a UI
// component without a reference to the ASP.NET Core framework. The rule matches
// the base type by name + namespace, which this reproduces exactly.
public class ComponentBase
{
}
