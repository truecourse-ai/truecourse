using System.Text.Json;

namespace UserServiceApp.Services;

public class TokenService
{
    private readonly Dictionary<string, string> _cache = new();

    public string? GetToken(int userId)
    {
        return _cache.TryGetValue(userId.ToString(), out var token) ? token : null;
    }

    public bool ValidateToken(string token)
    {
        try
        {
            var data = JsonSerializer.Deserialize<Dictionary<string, object>>(token);
            return data != null && data.ContainsKey("user_id");
        }
        catch (JsonException)
        {
            return false;
        }
    }

    public string? RefreshToken(int userId)
    {
        var old = GetToken(userId);
        if (old == null)
        {
            return null;
        }
        var newToken = $"refreshed_{old}";
        _cache[userId.ToString()] = newToken;
        return newToken;
    }

    public Dictionary<string, object?> BuildOAuthConfig()
    {
        return new Dictionary<string, object?>
        {
            ["token_uri"] = "https://oauth2.example.com/token",
            ["client_secret"] = _cache.GetValueOrDefault("client_secret", ""),
            ["access_token"] = GetToken(0)
        };
    }
}

public static class TokenServiceModule
{
    public static bool ShouldRetry(int attemptNumber)
    {
        return attemptNumber < 3;
    }

    public static TokenService GetTokenService()
    {
        return new TokenService();
    }
}
