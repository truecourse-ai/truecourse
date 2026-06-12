// An ADR calls for Vite as the build system, but this service ships no build
// config of any kind (no vite/webpack/etc.), so the build system can't be
// determined from the code.
// IL-DRIFT: ArchitectureDecision:build-system.vite / architecture.build-system.inconclusive
using SampleApi.Endpoints;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddAuthorization();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.MapCustomerEndpoints();

app.Run();
