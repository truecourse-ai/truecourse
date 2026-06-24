using System;
using System.Diagnostics;
using System.Reflection;
using System.Threading;

namespace UserServiceApp.Violations.Performance;

internal sealed class RuntimeProbe
{
    internal Assembly OwningAssembly()
    {
        // VIOLATION: performance/deterministic/get-executing-assembly
        return Assembly.GetExecutingAssembly();
    }

    internal int CurrentThreadTag()
    {
        // VIOLATION: performance/deterministic/use-currentmanagedthreadid
        return Thread.CurrentThread.ManagedThreadId;
    }

    internal int CurrentProcessId()
    {
        // VIOLATION: performance/deterministic/use-environment-processid
        return Process.GetCurrentProcess().Id;
    }

    internal string CurrentProcessPath()
    {
        // VIOLATION: performance/deterministic/use-environment-processpath
        return Process.GetCurrentProcess().MainModule.FileName;
    }

    internal void ReclaimMemory()
    {
        // VIOLATION: performance/deterministic/explicit-gc-collect
        GC.Collect();
    }
}
