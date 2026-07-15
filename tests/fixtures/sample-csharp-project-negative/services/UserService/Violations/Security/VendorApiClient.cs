namespace UserServiceApp.Violations.Security;

/// <summary>Holds a hardcoded third-party API key — a real leaked credential in source.</summary>
internal static class VendorApiClient
{
    // VIOLATION: security/deterministic/hardcoded-secret
    private const string ApiKey = "h6JsqmOJRUeLjSA6K7ydR2nvJPy37RvYPdnmOY1l";

    /// <summary>Returns the configured vendor key.</summary>
    public static string Current() => ApiKey;
}
