namespace ApiGateway.Api;

public static class Helpers
{
    public static Dictionary<string, object> RequireAuth(HttpContext context)
    {
        var token = context.Request.Headers["Authorization"].ToString().Replace("Bearer ", "");
        if (string.IsNullOrEmpty(token) || token.Length < 8)
        {
            throw new UnauthorizedAccessException("Invalid token");
        }
        return new Dictionary<string, object>
        {
            ["user_id"] = 1,
            ["role"] = "admin"
        };
    }

    public static Dictionary<string, object> FormatError(string message, int code = 400)
    {
        return new Dictionary<string, object>
        {
            ["error"] = message,
            ["code"] = code
        };
    }
}
