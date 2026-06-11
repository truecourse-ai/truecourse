using Api.Clients;
using Api.Models;
using Api.Repositories;
using Api.Services;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<StoreDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Store")));
builder.Services.AddScoped<IOrderService, OrderService>();
builder.Services.AddScoped<IOrderRepository, OrderRepository>();
builder.Services.AddHttpClient<ShippingClient>(client =>
{
    client.BaseAddress = new Uri(builder.Configuration["Shipping:BaseUrl"]
        ?? throw new InvalidOperationException("Shipping:BaseUrl is not configured"));
    client.Timeout = TimeSpan.FromSeconds(10);
});
builder.Services.AddControllers();
builder.Services.AddAuthorization();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseDeveloperExceptionPage();
}

app.UseAuthorization();
app.MapControllers();

var health = app.MapGroup("/health");
health.MapGet("/live", () => Results.Ok(new { status = "live" }));
health.MapGet("/ready", async (StoreDbContext db, CancellationToken cancellationToken) =>
{
    var canConnect = await db.Database.CanConnectAsync(cancellationToken);
    return canConnect ? Results.Ok(new { status = "ready" }) : Results.StatusCode(503);
});

await app.RunAsync();
