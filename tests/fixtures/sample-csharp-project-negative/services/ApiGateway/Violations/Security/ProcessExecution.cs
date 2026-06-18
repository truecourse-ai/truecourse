using System.Diagnostics;

namespace ApiGateway.Violations.Security;

internal sealed class ProcessExecution
{
    internal void RunUserCommand(string userCommand)
    {
        // VIOLATION: security/deterministic/os-command-injection
        Process.Start("/bin/bash", $"-c \"{userCommand}\"");
    }

    internal void CleanupCache()
    {
        // VIOLATION: security/deterministic/wildcard-in-os-command
        Process.Start("/bin/sh", "-c \"rm -rf /var/cache/gateway/*\"");
    }
}
