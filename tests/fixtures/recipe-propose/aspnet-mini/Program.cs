// A minimal-API ASP.NET app: one health route and one business route. Kestrel
// binds whatever ASPNETCORE_URLS names — which is why the proposed recipe carries
// it as api.env with the ${PORT} placeholder.
var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.MapGet("/healthz", () => Results.Ok(new { status = "ok" }));
app.MapGet("/forecast", () => Results.Ok(new { forecast = "sunny" }));

app.Run();
