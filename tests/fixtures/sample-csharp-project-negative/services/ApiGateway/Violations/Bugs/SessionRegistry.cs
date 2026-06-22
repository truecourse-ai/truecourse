using System.Collections.Generic;

namespace ApiGateway.Violations.Bugs;

// VIOLATION: code-quality/deterministic/class-as-data-structure
internal sealed class SessionNode
{
    // VIOLATION: code-quality/deterministic/non-private-field
    public SessionNode Next;
    // VIOLATION: code-quality/deterministic/non-private-field
    public int Weight;
}

internal static class SessionTracker
{
    private static readonly List<object> Live = new();

    /// <summary>Records a live session for tracking.</summary>
    public static void Register(object session) => Live.Add(session);
}

// A node in the live-session list with several subtle defects: a base constructor
// that calls a virtual method, the instance escaping via `this` to a registry during
// construction, a property whose getter and setter touch different fields, and a
// chained assignment that mutates a symbol and its member in one statement.
internal class SessionRegistry
{
    private int _ttlSeconds;
    // Written by the setter but never read — the getter reads the wrong field.
    // VIOLATION: code-quality/deterministic/unread-private-attribute
    private int _idleSeconds;

    internal SessionRegistry()
    {
        // Calling a virtual method from the constructor runs the most-derived override
        // before the subclass is initialized.
        // VIOLATION: bugs/deterministic/constructor-calls-virtual-method
        // VIOLATION: bugs/deterministic/virtual-call-in-constructor
        Initialize();

        // Passing `this` to an external registry leaks a half-constructed instance.
        // VIOLATION: bugs/deterministic/this-escapes-constructor
        SessionTracker.Register(this);
    }

    protected virtual void Initialize()
    {
        _ttlSeconds = 300;
    }

    // The getter reads _ttlSeconds but the setter writes _idleSeconds — a copy/paste slip.
    // VIOLATION: bugs/deterministic/getter-setter-wrong-field
    internal int Ttl
    {
        get { return _ttlSeconds; }
        set { _idleSeconds = value; }
    }

    internal void Relink(SessionNode head)
    {
        // `head` and `head.Next` assigned in one statement — ambiguous ordering.
        // VIOLATION: bugs/deterministic/symbol-and-member-same-statement
        // VIOLATION: code-quality/deterministic/parameter-reassignment
        // VIOLATION: code-quality/deterministic/multi-assign
        head = head.Next = null;
    }
}
