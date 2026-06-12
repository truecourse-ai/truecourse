using Microsoft.AspNetCore.Mvc;
using ApiGateway.Services;

namespace ApiGateway.Controllers;

[ApiController]
[Route("api/[controller]")]
public class StatusController : ControllerBase
{
    private readonly HealthService _healthService;

    public StatusController(HealthService healthService)
    {
        _healthService = healthService;
    }

    [HttpGet]
    public IActionResult Get()
    {
        return Ok(_healthService.Check());
    }

    [HttpGet("{component}")]
    public IActionResult GetComponent(string component)
    {
        var status = _healthService.Check();
        if (!status.ContainsKey(component))
        {
            return NotFound(new { error = $"Unknown component: {component}" });
        }
        return Ok(new { component, status = status[component] });
    }
}
