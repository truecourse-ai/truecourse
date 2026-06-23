using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.Hosting;

namespace Positive.Boundary.Security;

/// <summary>Registers the developer exception page only in the Development environment.</summary>
public sealed class ProductionDebugEnabledSafe
{
    /// <summary>Configures error handling, gating the developer page behind an environment check.</summary>
    internal void Configure(WebApplication app)
    {
        if (app.Environment.IsDevelopment())
        {
            // SAFE: security/deterministic/production-debug-enabled
            app.UseDeveloperExceptionPage();
        }
    }
}
