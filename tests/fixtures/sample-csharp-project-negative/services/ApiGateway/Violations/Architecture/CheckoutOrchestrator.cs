using Microsoft.Extensions.DependencyInjection;

namespace ApiGateway.Violations.Architecture;

// Collaborator abstractions that make up the checkout domain. Each interface is a
// distinct dependency the orchestrator below has to know about.
internal interface ICart { decimal Total { get; } }
internal interface ICartValidator { bool Validate(ICart cart); }
internal interface IInventoryService { bool Reserve(string sku); }
internal interface IPricingEngine { decimal Price(ICart cart); }
internal interface ITaxCalculator { decimal Tax(decimal amount); }
internal interface IDiscountEngine { decimal Apply(decimal amount); }
internal interface ICouponService { bool Redeem(string code); }
internal interface IPaymentGateway { string Charge(decimal amount); }
internal interface IFraudDetector { bool IsFraud(string token); }
internal interface IWalletService { decimal Balance(string user); }
internal interface IShippingCalculator { decimal Cost(string zip); }
internal interface IAddressValidator { bool Validate(string address); }
internal interface ICustomerProfile { string Tier { get; } }
internal interface ILoyaltyService { int Points(string user); }
internal interface INotificationService { void Send(string user, string message); }
internal interface IEmailFormatter { string Format(string body); }
internal interface IReceiptBuilder { string Build(ICart cart); }
internal interface IOrderRepository { void Save(string id); }
internal interface IAuditLogger { void Record(string @event); }
internal interface IMetricsRecorder { void Increment(string name); }
internal interface IFeatureFlags { bool Enabled(string flag); }
internal interface ICurrencyConverter { decimal Convert(decimal amount, string currency); }

/// <summary>
/// A checkout facade that wires together the entire purchase flow in one class. It
/// resolves two dozen distinct collaborators from the container, concentrating the whole
/// domain's coupling in a single fragile type that has to change whenever any
/// collaborator does.
/// </summary>
// VIOLATION: architecture/deterministic/class-coupled-to-too-many
public sealed class CheckoutOrchestrator
{
    private readonly IServiceProvider _services;

    /// <summary>Creates the orchestrator over the application's service container.</summary>
    public CheckoutOrchestrator(IServiceProvider services) => _services = services;

    /// <summary>Runs the full purchase flow and returns the receipt text.</summary>
    public string PlaceOrder(ICart cart, ICustomerProfile profile, string coupon, string zip)
    {
        _services.GetRequiredService<ICartValidator>().Validate(cart);
        _services.GetRequiredService<IInventoryService>().Reserve("sku-1");
        var subtotal = _services.GetRequiredService<IPricingEngine>().Price(cart);
        subtotal = _services.GetRequiredService<IDiscountEngine>().Apply(subtotal);
        _services.GetRequiredService<ICouponService>().Redeem(coupon);
        var tax = _services.GetRequiredService<ITaxCalculator>().Tax(subtotal);
        var shipping = _services.GetRequiredService<IShippingCalculator>().Cost(zip);
        _services.GetRequiredService<IAddressValidator>().Validate(zip);
        var total = _services.GetRequiredService<ICurrencyConverter>().Convert(subtotal + tax + shipping, "USD");
        _services.GetRequiredService<IFraudDetector>().IsFraud("token");
        _services.GetRequiredService<IWalletService>().Balance(profile.Tier);
        _services.GetRequiredService<IPaymentGateway>().Charge(total);
        _services.GetRequiredService<ILoyaltyService>().Points(profile.Tier);
        var receipt = _services.GetRequiredService<IReceiptBuilder>().Build(cart);
        _services.GetRequiredService<IEmailFormatter>().Format(receipt);
        _services.GetRequiredService<INotificationService>().Send(profile.Tier, receipt);
        _services.GetRequiredService<IOrderRepository>().Save("order-1");
        _services.GetRequiredService<IAuditLogger>().Record("placed");
        _services.GetRequiredService<IMetricsRecorder>().Increment("orders");
        _services.GetRequiredService<IFeatureFlags>().Enabled("checkout-v2");
        return receipt;
    }
}
