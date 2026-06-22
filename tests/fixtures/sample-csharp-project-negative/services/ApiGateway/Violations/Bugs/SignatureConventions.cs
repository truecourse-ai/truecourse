namespace ApiGateway.Violations.Bugs;

internal sealed class SignatureConventions
{
    private int _calls;

    // VIOLATION: bugs/deterministic/caller-info-param-not-last
    internal void Trace([CallerMemberName] string member, string message)
    {
        _calls += member.Length + message.Length;
    }

    // VIOLATION: bugs/deterministic/cancellation-token-not-last
    internal Task ReplicateAsync(CancellationToken token, string target)
    {
        _calls++;
        return Channel.SendAsync(target, token);
    }
}
