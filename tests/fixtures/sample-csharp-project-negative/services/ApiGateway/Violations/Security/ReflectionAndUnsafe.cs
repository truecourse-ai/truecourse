using System;
using System.Reflection;

namespace ApiGateway.Violations.Security;

internal sealed class ReflectionAndUnsafe
{
    internal object? ReadPrivateField(object target, string name)
    {
        // VIOLATION: security/deterministic/reflection-bypass-accessibility
        var field = target.GetType().GetField(name, BindingFlags.NonPublic | BindingFlags.Instance);
        return field?.GetValue(target);
    }

    internal unsafe int ReadFirstByte(byte[] buffer)
    {
        // VIOLATION: security/deterministic/unsafe-code-block
        fixed (byte* pointer = buffer)
        {
            return *pointer;
        }
    }
}
