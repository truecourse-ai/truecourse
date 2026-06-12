namespace Billing;

using Billing.Models;
using Billing.Legacy;

public class CustomerSync
{
    // Customer is visible from BOTH Billing.Models and Billing.Legacy —
    // genuinely ambiguous (this would be a compile error in C# too without
    // qualification), so the index must skip it rather than guess.
    public object Load(string id) => new Customer { };
}
