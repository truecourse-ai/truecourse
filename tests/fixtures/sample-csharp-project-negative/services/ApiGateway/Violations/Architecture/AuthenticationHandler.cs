namespace ApiGateway.Violations.Architecture;

/// <summary>Authenticates the caller before the request proceeds.</summary>
public class AuthenticationHandler : MetricsHandler
{
    /// <summary>True when the payload carries a recognised identity.</summary>
    protected bool IsAuthenticated(string payload) => payload.Length > 0;
}

/// <summary>Authorizes the authenticated caller for the requested action.</summary>
public class AuthorizationHandler : AuthenticationHandler
{
    /// <summary>True when the caller is permitted to perform the action.</summary>
    protected bool IsAuthorized(string payload) => payload.Length > 1;
}

/// <summary>Validates the request body against the schema.</summary>
public class ValidationHandler : AuthorizationHandler
{
    /// <summary>True when the payload satisfies the request schema.</summary>
    protected bool IsValid(string payload) => payload.Length > 2;
}
