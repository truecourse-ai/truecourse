namespace Positive.Boundary.Bugs;

/// <summary>Request builder whose overloads differ by a required trailing parameter.</summary>
public sealed class OverlappingDefaultOverloadsSafe
{
    private int _lastId;

    /// <summary>Builds a request from an id alone.</summary>
    public void Build(int id)
    {
        _lastId = id;
    }

    /// <summary>Builds a request with an explicit, required retry count.</summary>
    // SAFE: bugs/deterministic/overlapping-default-overloads
    public void Build(int id, int retries)
    {
        _lastId = id + retries;
    }

    /// <summary>The most recently built id.</summary>
    public int LastId => _lastId;
}
