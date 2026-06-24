namespace Positive.Boundary.Bugs;

/// <summary>
/// A partial pipeline type whose classic void partial hook is declared in one part and
/// implemented in another. Because an implementing part exists, the compiler keeps the
/// method and its calls, so the rule must not fire.
/// </summary>
public partial class PartialMethodNotImplementedSafe
{
    private int _stage;

    /// <summary>The current stage counter.</summary>
    public int Stage => _stage;

    // SAFE: bugs/deterministic/partial-method-not-implemented
    private partial void OnStageAdvanced();

    /// <summary>Advances the stage and fires the hook.</summary>
    public void Advance()
    {
        _stage++;
        OnStageAdvanced();
    }
}

/// <summary>The implementing part that supplies the partial hook body.</summary>
public partial class PartialMethodNotImplementedSafe
{
    private partial void OnStageAdvanced()
    {
        _stage += 1;
    }
}
