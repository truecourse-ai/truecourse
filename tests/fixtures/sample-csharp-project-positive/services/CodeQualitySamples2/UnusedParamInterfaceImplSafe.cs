namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Implicitly implements an interface method whose declaring interface lives in an
/// assembly this loose-text pass cannot resolve (mirrors implementing ASP.NET Core's
/// IAsyncPageFilter / IAuthorizationService). The signature is contract-fixed by that
/// interface, so an unreferenced parameter must NOT be flagged — renaming or removing
/// it would break the implementation.
/// </summary>
public class UnusedParamInterfaceImplSafe : IExternalHandlerContract
{
    // SAFE: code-quality/deterministic/unused-function-parameter
    public int Handle(string request) => 0;
}
