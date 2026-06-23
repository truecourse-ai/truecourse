using System;

namespace Positive.Boundary.Bugs;

/// <summary>Resolves the runtime type of an ordinary instance, not a Type value.</summary>
public sealed class GetTypeOnTypeInstanceSafe
{
    /// <summary>Returns the runtime type of the supplied object.</summary>
    internal Type Describe(object instance)
    {
        // SAFE: bugs/deterministic/gettype-on-type-instance
        return instance.GetType();
    }
}
