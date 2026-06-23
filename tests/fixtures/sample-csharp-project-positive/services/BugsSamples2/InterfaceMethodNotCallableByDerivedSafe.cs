namespace Positive.Boundary.Bugs;

internal interface IDispatchSink
{
    void Dispatch();
}

/// <summary>Sink with an explicit interface implementation on a sealed type.</summary>
public sealed class InterfaceMethodNotCallableByDerivedSafe : IDispatchSink
{
    private int _count;

    // SAFE: bugs/deterministic/interface-method-not-callable-by-derived
    void IDispatchSink.Dispatch()
    {
        _count += 1;
    }

    /// <summary>Reports how many dispatches have been recorded.</summary>
    internal int Count()
    {
        return _count;
    }
}
