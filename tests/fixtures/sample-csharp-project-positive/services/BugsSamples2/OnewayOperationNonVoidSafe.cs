namespace Positive.Boundary.Bugs;

/// <summary>A WCF-style service whose one-way operation correctly returns void.</summary>
[ServiceContract]
public sealed class OnewayOperationNonVoidSafe
{
    private string _last = string.Empty;

    /// <summary>The last message that was sent.</summary>
    public string Last => _last;

    /// <summary>Fires a notification with no response channel.</summary>
    // SAFE: bugs/deterministic/oneway-operation-non-void
    [OperationContract(IsOneWay = true)]
    public void Notify(string message)
    {
        _last = message;
    }
}
