using StackExchange.Redis;

namespace ApiGateway.Cache;

public static class RedisClient
{
    private static readonly ConnectionMultiplexer _redis = ConnectionMultiplexer.Connect(
        Environment.GetEnvironmentVariable("REDIS_URL") ?? "localhost:6379"
    );

    public static string? GetCache(string key)
    {
        var db = _redis.GetDatabase();
        return db.StringGet(key);
    }

    public static void SetCache(string key, string value, int ttl = 300)
    {
        var db = _redis.GetDatabase();
        db.StringSet(key, value, TimeSpan.FromSeconds(ttl));
    }
}
