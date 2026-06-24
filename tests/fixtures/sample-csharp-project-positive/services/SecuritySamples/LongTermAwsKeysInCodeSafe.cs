namespace Positive.Boundary.Security;

/// <summary>Holds the AWS secret supplied by the caller rather than a hardcoded literal.</summary>
public sealed class LongTermAwsKeysInCodeSafe
{
    private readonly string _awsSecretKey;

    /// <summary>Captures the AWS secret access key resolved outside this type.</summary>
    internal LongTermAwsKeysInCodeSafe(string resolvedSecret)
    {
        // SAFE: security/deterministic/long-term-aws-keys-in-code
        _awsSecretKey = resolvedSecret;
    }

    /// <summary>Returns the configured AWS secret access key.</summary>
    internal string LoadAwsSecret()
    {
        return _awsSecretKey;
    }
}
