using Amazon.S3;

namespace Positive.Boundary.Security;

/// <summary>Builds an S3 client config that keeps transport over HTTPS.</summary>
public sealed class S3InsecureHttpSafe
{
    /// <summary>Returns an S3 config that leaves SSL enabled.</summary>
    internal AmazonS3Config BuildS3Config()
    {
        // SAFE: security/deterministic/s3-insecure-http
        return new AmazonS3Config { UseHttp = false };
    }
}
