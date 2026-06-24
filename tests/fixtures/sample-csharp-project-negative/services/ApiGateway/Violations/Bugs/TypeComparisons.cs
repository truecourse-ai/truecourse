using System;
using System.Collections.Generic;

namespace ApiGateway.Violations.Bugs;

internal class Resource { }

internal sealed class CachedResource : Resource { }

// Inspects and stores resources using type-system operations that misbehave: array
// covariance, an implicit foreach downcast, GetType on a Type, ReferenceEquals on a
// value type, and a Span compared to null.
internal sealed class TypeComparisons
{
    internal Resource[] BuildPool()
    {
        // A CachedResource[] stored through a Resource[] reference — writing a plain
        // Resource into it throws ArrayTypeMismatchException at runtime.
        // VIOLATION: bugs/deterministic/array-covariance
        // VIOLATION: code-quality/deterministic/prefer-immediate-return
        Resource[] pool = new CachedResource[4];
        return pool;
    }

    // VIOLATION: code-quality/deterministic/parameter-narrower-than-needed
    internal void Refresh(List<Resource> resources)
    {
        // Declares CachedResource over a List<Resource> — an InvalidCastException if any
        // element is a plain Resource.
        // VIOLATION: bugs/deterministic/foreach-implicit-downcast
        foreach (CachedResource cached in resources)
        {
            _ = cached;
        }
    }

    internal Type Describe(Type declared)
    {
        // GetType() on something already typed as Type returns RuntimeType, not the
        // type it represents.
        // VIOLATION: bugs/deterministic/gettype-on-type-instance
        return declared.GetType();
    }

    internal bool SameHandle(int left, int right)
    {
        // ReferenceEquals boxes both ints into distinct objects — always false.
        // VIOLATION: bugs/deterministic/referenceequals-on-value-type
        return ReferenceEquals(left, right);
    }

    internal bool IsAbsent(Span<byte> buffer)
    {
        // Span<T> == null compares against Span<T>.Empty, i.e. tests emptiness.
        // VIOLATION: bugs/deterministic/span-compared-to-null
        return buffer == null;
    }
}
