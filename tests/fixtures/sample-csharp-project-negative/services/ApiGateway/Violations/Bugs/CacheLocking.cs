using System;
using System.Collections.Generic;

namespace ApiGateway.Violations.Bugs;

// A small in-memory cache whose synchronization is riddled with bad lock targets:
// a non-readonly gate field, `this`/`typeof`/string-literal shared locks, and a
// weak-identity (string/Type) lock object.
internal sealed class CacheLocking
{
    // Reassignable, so two threads can end up locking different objects.
    // VIOLATION: code-quality/deterministic/mutable-private-member
    // VIOLATION: code-quality/deterministic/field-can-be-readonly
    private object _gate = new object();

    private readonly Dictionary<string, int> _entries = new();

    internal void Touch(string key)
    {
        // VIOLATION: bugs/deterministic/lock-on-non-readonly-field
        lock (_gate)
        {
            _entries[key] = _entries.TryGetValue(key, out var n) ? n + 1 : 1;
        }
    }

    internal void Clear()
    {
        // Locking on `this` lets any external holder of the cache lock it too.
        // VIOLATION: bugs/deterministic/lock-on-shared-instance
        // VIOLATION: bugs/deterministic/lock-on-public-reference
        lock (this)
        {
            _entries.Clear();
        }
    }

    internal void ResetType()
    {
        // typeof(CacheLocking) is process-wide shared.
        // VIOLATION: bugs/deterministic/lock-on-shared-instance
        // VIOLATION: bugs/deterministic/lock-on-weak-identity-object
        // VIOLATION: bugs/deterministic/lock-on-public-reference
        lock (typeof(CacheLocking))
        {
            _entries.Clear();
        }
    }

    internal void GuardByName(string region)
    {
        // A string parameter has weak identity — interned strings are AppDomain-shared.
        // VIOLATION: bugs/deterministic/lock-on-weak-identity-object
        lock (region)
        {
            _entries.Remove(region);
        }
    }

    internal void GuardByType(Type owner)
    {
        // A Type instance also has weak identity.
        // VIOLATION: bugs/deterministic/lock-on-weak-identity-object
        lock (owner)
        {
            _entries.Clear();
        }
    }
}
