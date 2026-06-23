using System.Diagnostics;

namespace Positive.Boundary.Security;

/// <summary>Runs a fixed executable, passing values through ArgumentList without shell parsing.</summary>
public sealed class OsCommandInjectionSafe
{
    private const string GitExecutable = "/usr/bin/git";

    /// <summary>Starts git with the branch name supplied as a discrete argument.</summary>
    internal void Checkout(string branch)
    {
        var psi = new ProcessStartInfo { FileName = GitExecutable };
        psi.ArgumentList.Add("checkout");
        // SAFE: security/deterministic/os-command-injection
        psi.ArgumentList.Add(branch);
        Process.Start(psi);
    }
}
