using System.Text;
using System.Text.Json;
using Shared.Utils;

namespace ApiGateway.Services;

public class UserService
{
    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;

    public UserService()
    {
        _httpClient = new HttpClient();
        _baseUrl = Environment.GetEnvironmentVariable("USER_SERVICE_URL") ?? "http://localhost:3001";
    }

    public List<Dictionary<string, object>> FindAll()
    {
        var response = _httpClient.GetAsync($"{_baseUrl}/users").Result;
        var json = response.Content.ReadAsStringAsync().Result;
        var users = JsonSerializer.Deserialize<List<Dictionary<string, object>>>(json)!;
        return users.Select(u => Formatters.FormatUser(u)).ToList();
    }

    public Dictionary<string, object>? FindById(string userId)
    {
        var response = _httpClient.GetAsync($"{_baseUrl}/users/{userId}").Result;
        var json = response.Content.ReadAsStringAsync().Result;
        var user = JsonSerializer.Deserialize<Dictionary<string, object>>(json)!;
        return Formatters.FormatUser(user);
    }

    public Dictionary<string, object> Create(Dictionary<string, object> data)
    {
        var content = new StringContent(JsonSerializer.Serialize(data), Encoding.UTF8, "application/json");
        var response = _httpClient.PostAsync($"{_baseUrl}/users", content).Result;
        var json = response.Content.ReadAsStringAsync().Result;
        var user = JsonSerializer.Deserialize<Dictionary<string, object>>(json)!;
        return Formatters.FormatUser(user);
    }

    public void Delete(string userId)
    {
        _httpClient.DeleteAsync($"{_baseUrl}/users/{userId}").Wait();
    }
}
