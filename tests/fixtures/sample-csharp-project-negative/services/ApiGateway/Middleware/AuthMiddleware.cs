namespace ApiGateway.Middleware;

public class AuthMiddleware
{
    private readonly RequestDelegate _next;

    public AuthMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var token = context.Request.Headers["Authorization"].ToString().Replace("Bearer ", "");
        if (!string.IsNullOrEmpty(token))
        {
            context.Items["UserId"] = "authenticated-user";
        }
        await _next(context);
    }
}
