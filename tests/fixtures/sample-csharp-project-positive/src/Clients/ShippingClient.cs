using System.Net.Http.Json;

namespace Api.Clients;

/// <summary>Typed HTTP client for the shipping carrier API.</summary>
public class ShippingClient
{
    private readonly HttpClient _http;
    private readonly ILogger<ShippingClient> _logger;

    /// <summary>Creates the client over the factory-configured HttpClient.</summary>
    public ShippingClient(HttpClient http, ILogger<ShippingClient> logger)
    {
        _http = http;
        _logger = logger;
    }

    /// <summary>Requests a carrier pickup for the order; true when accepted.</summary>
    public async Task<bool> RequestPickupAsync(Guid orderId, CancellationToken cancellationToken)
    {
        try
        {
            var response = await _http.PostAsJsonAsync("pickups", new { orderId }, cancellationToken);
            return response.IsSuccessStatusCode;
        }
        catch (HttpRequestException exception)
        {
            _logger.LogError(exception, "Pickup request failed for order {OrderId}", orderId);
            return false;
        }
    }
}
