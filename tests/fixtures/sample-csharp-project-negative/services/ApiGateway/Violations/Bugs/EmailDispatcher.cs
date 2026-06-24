using System.ComponentModel.Composition;

namespace ApiGateway.Violations.Bugs;

internal interface INotifier
{
    void Notify(string message);
}

/// <summary>
/// Exported as INotifier but it never implements the interface — a rename left the class
/// behind — so MEF composition throws the moment INotifier is imported.
/// </summary>
// VIOLATION: bugs/deterministic/export-interface-not-implemented
[Export(typeof(INotifier))]
[PartCreationPolicy(CreationPolicy.NonShared)]
internal sealed class EmailDispatcher
{
    /// <summary>The address messages are sent from.</summary>
    public string FromAddress { get; init; } = string.Empty;
}
