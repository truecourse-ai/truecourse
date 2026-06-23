using System.ComponentModel.Composition;

namespace Positive.Boundary.Bugs;

/// <summary>Sends notifications to a destination.</summary>
public interface INotifierContract
{
    /// <summary>Sends a notification with the given body.</summary>
    void Notify(string body);
}

/// <summary>A MEF export whose type actually implements its exported contract.</summary>
// SAFE: bugs/deterministic/export-interface-not-implemented
[Export(typeof(INotifierContract))]
[PartCreationPolicy(CreationPolicy.NonShared)]
public sealed class ExportInterfaceNotImplementedSafe : INotifierContract
{
    private string _last = string.Empty;

    /// <summary>Last notification body sent.</summary>
    public string Last => _last;

    /// <summary>Sends a notification by recording its body.</summary>
    public void Notify(string body)
    {
        _last = body;
    }
}
