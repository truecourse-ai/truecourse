namespace Positive.Boundary.Reliability;

internal sealed class UncheckedOptionalChainDepthSafe
{
    internal string? BillingCity(CustomerAccount? account)
    {
        // SAFE: reliability/deterministic/unchecked-optional-chain-depth
        return account?.Profile?.Address?.City;
    }
}

internal sealed record CustomerAccount(CustomerProfile? Profile);

internal sealed record CustomerProfile(PostalAddress? Address);

internal sealed record PostalAddress(string? City);
