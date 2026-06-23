using System.Reflection;

namespace Positive.Boundary.Performance;

/// <summary>Resolves the owning assembly via a direct metadata read.</summary>
public sealed class GetExecutingAssemblySafe
{
    /// <summary>Returns this type's assembly without walking the stack.</summary>
    internal Assembly OwningAssembly()
    {
        // SAFE: performance/deterministic/get-executing-assembly
        return typeof(GetExecutingAssemblySafe).Assembly;
    }
}
