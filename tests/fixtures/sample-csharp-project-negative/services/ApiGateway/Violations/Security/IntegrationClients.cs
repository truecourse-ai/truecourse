using Amazon.S3;
using Lextm.SharpSnmpLib;
using Lextm.SharpSnmpLib.Security;
using Renci.SshNet;
using Renci.SshNet.Common;

namespace ApiGateway.Violations.Security;

internal sealed class IntegrationClients
{
    internal void AcceptHostKey(HostKeyEventArgs e)
    {
        // VIOLATION: security/deterministic/ssh-no-host-key-verification
        e.CanTrust = true;
    }

    internal VersionCode LegacySnmpVersion()
    {
        // VIOLATION: security/deterministic/snmp-insecure-version
        return VersionCode.V1;
    }

    internal IPrivacyProvider BuildPrivacyProvider(OctetString phrase)
    {
        // VIOLATION: security/deterministic/snmp-weak-crypto
        return new DESPrivacyProvider(phrase);
    }

    internal AmazonS3Config BuildS3Config()
    {
        // VIOLATION: security/deterministic/s3-insecure-http
        return new AmazonS3Config { UseHttp = true };
    }
}
