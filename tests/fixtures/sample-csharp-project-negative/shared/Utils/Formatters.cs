namespace Shared.Utils;

public static class Formatters
{
    public static Dictionary<string, object> FormatUser(Dictionary<string, object> user)
    {
        return new Dictionary<string, object>
        {
            ["id"] = user["id"],
            ["name"] = user["name"],
            ["email"] = user["email"],
            ["displayName"] = $"{user["name"]} <{user["email"]}>",
            ["createdAt"] = DateTime.Parse(user["createdAt"].ToString()!).ToString("o")
        };
    }

    public static string FormatDate(DateTime date)
    {
        return date.ToString("yyyy-MM-dd");
    }
}
