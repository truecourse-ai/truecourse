using Renci.SshNet.Common;

namespace Positive.Boundary.Security;

/// <summary>Trusts an SSH host key only when its fingerprint matches the pin.</summary>
public sealed class SshNoHostKeyVerificationSafe
{
    private const string ExpectedFingerprint = "a1b2c3";

    /// <summary>Handles HostKeyReceived, accepting only the pinned fingerprint.</summary>
    internal void OnHostKeyReceived(HostKeyEventArgs e)
    {
        if (e.FingerPrintSHA256 == ExpectedFingerprint)
        {
            // SAFE: security/deterministic/ssh-no-host-key-verification
            e.CanTrust = true;
        }
    }
}
