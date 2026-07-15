using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// ASP.NET Core middleware convention: the pipeline invokes the component through
/// a method named <c>Invoke</c> whose first parameter is the <c>HttpContext</c>.
/// <c>UseMiddleware</c> binds it by that exact name, so the <c>Async</c> suffix
/// must not be added — async-method-naming must not fire here.
/// </summary>
public sealed class RequestTimingMiddleware
{
    private readonly RequestDelegate _next;

    /// <summary>Captures the next component in the request pipeline.</summary>
    public RequestTimingMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    /// <summary>Runs the middleware for the current request.</summary>
    // SAFE: code-quality/deterministic/async-method-naming
    public async Task Invoke(HttpContext context)
    {
        await _next(context);
    }
}
