namespace UserServiceApp.Violations.CodeQuality;

internal class StockContext
{
    public bool HasBackorders { get; set; }
    public bool AllowPartialFill { get; set; }
    public int ReservedUnits { get; set; }
    public int AvailableUnits { get; set; }
    public bool HasReturns { get; set; }
    public bool RestockReturns { get; set; }
    public int ReturnUnits { get; set; }
    public int DamagedUnits { get; set; }
    public bool HasTransfers { get; set; }
    public bool AcceptInbound { get; set; }
    public int InboundUnits { get; set; }
    public int SafetyUnits { get; set; }
}

internal class PricingContext
{
    public bool IsActive { get; set; }
    public bool HasContract { get; set; }
    public int ContractYears { get; set; }
    public bool IsWholesale { get; set; }
    public int AnnualVolume { get; set; }
    public int VolumeFloor { get; set; }
    public bool PaysEarly { get; set; }
}

internal class LegacyOrderProcessor
{
    // VIOLATION: code-quality/deterministic/cognitive-complexity
    internal int ReconcileInventory(StockContext stock)
    {
        var shortages = 0;
        var restocked = 0;
        var inbound = 0;
        if (stock.HasBackorders)
        {
            shortages++;
            if (stock.AllowPartialFill)
            {
                shortages++;
                if (stock.ReservedUnits > stock.AvailableUnits)
                {
                    shortages++;
                }
            }
        }
        if (stock.HasReturns)
        {
            restocked++;
            if (stock.RestockReturns)
            {
                restocked++;
                if (stock.ReturnUnits > stock.DamagedUnits)
                {
                    restocked++;
                }
            }
        }
        if (stock.HasTransfers)
        {
            inbound++;
            if (stock.AcceptInbound)
            {
                inbound++;
                if (stock.InboundUnits > stock.SafetyUnits)
                {
                    inbound++;
                }
            }
        }
        return shortages + restocked + inbound;
    }

    // VIOLATION: code-quality/deterministic/cyclomatic-complexity
    internal string ClassifyShipment(StockContext stock, PricingContext pricing, int weight, int declaredValue)
    {
        var weightBand = weight > declaredValue ? "heavy" : "standard";
        var insurance = pricing.HasContract ? "contract-cover" : "per-parcel";
        var customs = pricing.IsWholesale ? "bulk-entry" : "single-entry";
        var packing = stock.HasReturns ? "reused-carton" : "new-carton";
        var dock = stock.HasTransfers ? "transfer-dock" : "main-dock";
        var notes = "";
        if (stock.HasBackorders)
        {
            notes = "backorder";
        }
        if (pricing.PaysEarly)
        {
            notes = "priority";
        }
        if (stock.AcceptInbound)
        {
            notes = "inbound";
        }
        if (pricing.IsActive)
        {
            notes = "active";
        }
        if (stock.AllowPartialFill)
        {
            notes = "partial";
        }
        if (pricing.HasContract)
        {
            notes = "contract";
        }
        return string.Join("|", weightBand, insurance, customs, packing, dock, notes);
    }

    // VIOLATION: code-quality/deterministic/too-many-branches
    internal List<string> RouteOrder(StockContext stock, PricingContext pricing)
    {
        var zones = new List<string>();
        if (stock.HasBackorders)
        {
            zones.Add("backlog-bay");
        }
        if (stock.AllowPartialFill)
        {
            zones.Add("partial-bay");
        }
        if (stock.HasReturns)
        {
            zones.Add("returns-bay");
        }
        if (stock.RestockReturns)
        {
            zones.Add("restock-bay");
        }
        if (stock.HasTransfers)
        {
            zones.Add("transfer-bay");
        }
        if (stock.AcceptInbound)
        {
            zones.Add("inbound-bay");
        }
        if (pricing.IsActive)
        {
            zones.Add("active-lane");
        }
        if (pricing.HasContract)
        {
            zones.Add("contract-lane");
        }
        if (pricing.IsWholesale)
        {
            zones.Add("wholesale-lane");
        }
        if (pricing.PaysEarly)
        {
            zones.Add("priority-lane");
        }
        if (pricing.ContractYears > 1)
        {
            zones.Add("loyalty-lane");
        }
        return zones;
    }

    // VIOLATION: code-quality/deterministic/too-many-nested-blocks
    internal decimal ResolveDiscountTier(PricingContext pricing)
    {
        var discount = 0m;
        if (pricing.IsActive)
        {
            discount += 1m;
            if (pricing.HasContract)
            {
                discount += 1m;
                if (pricing.ContractYears > 1)
                {
                    discount += 1m;
                    if (pricing.IsWholesale)
                    {
                        discount += 1m;
                        // VIOLATION: code-quality/deterministic/max-nesting-depth
                        if (pricing.AnnualVolume > pricing.VolumeFloor)
                        {
                            discount += 1m;
                            if (pricing.PaysEarly)
                            {
                                discount += 1m;
                            }
                        }
                    }
                }
            }
        }
        return discount;
    }

    // VIOLATION: code-quality/deterministic/too-many-return-statements
    internal string LookupCarrierCode(string region)
    {
        if (region == "north")
        {
            return "NRD-01";
        }
        if (region == "south")
        {
            return "STH-02";
        }
        if (region == "east")
        {
            return "EST-03";
        }
        if (region == "west")
        {
            return "WST-04";
        }
        if (region == "central")
        {
            return "CTR-05";
        }
        return "GEN-00";
    }

    // VIOLATION: code-quality/deterministic/too-many-locals
    internal decimal BuildQuarterlySnapshot(decimal january, decimal february, decimal march, decimal carryover)
    {
        var gross = january + february + march;
        var net = gross - carryover;
        var bestMonth = Math.Max(january, february);
        var peak = Math.Max(bestMonth, march);
        var weakestMonth = Math.Min(january, february);
        var trough = Math.Min(weakestMonth, march);
        var swing = peak - trough;
        var openingBalance = carryover + january;
        var closingBalance = net + march;
        var momentum = closingBalance - openingBalance;
        var seasonalIndex = swing + momentum;
        var totalIndex = gross + net;
        return totalIndex + seasonalIndex;
    }

    // VIOLATION: code-quality/deterministic/max-statements-per-function
    // VIOLATION: code-quality/deterministic/too-many-statements
    // VIOLATION: code-quality/deterministic/too-many-lines
    internal string GenerateMonthlyStatement()
    {
        var report = new StringBuilder();
        report.AppendLine("Monthly fulfilment statement");
        report.AppendLine("Prepared by the warehouse operations desk");
        report.AppendLine("Section 1. Opening counts");
        report.AppendLine("Carried over backorders from prior month");
        report.AppendLine("Reserved units held for contract customers");
        report.AppendLine("Available units on primary shelving");
        report.AppendLine("Section 2. Receipts");
        report.AppendLine("Inbound transfers accepted at the dock");
        report.AppendLine("Returned items routed to inspection");
        report.AppendLine("Restocked items cleared by inspection");
        report.AppendLine("Damaged items written down");
        report.AppendLine("Section 3. Shipments");
        report.AppendLine("Standard parcels dispatched");
        report.AppendLine("Heavy freight dispatched");
        report.AppendLine("Priority parcels dispatched");
        report.AppendLine("Partial fills dispatched with notices");
        report.AppendLine("Section 4. Exceptions");
        report.AppendLine("Backorders escalated to purchasing");
        report.AppendLine("Transfers rejected at the dock");
        report.AppendLine("Inspection queue overflow events");
        report.AppendLine("Carrier pickup misses");
        report.AppendLine("Section 5. Contract accounts");
        report.AppendLine("Contract orders fulfilled in window");
        report.AppendLine("Contract orders fulfilled late");
        report.AppendLine("Early-payment credits granted");
        report.AppendLine("Wholesale bulk entries processed");
        report.AppendLine("Section 6. Storage");
        report.AppendLine("Pallet positions occupied");
        report.AppendLine("Pallet positions released");
        report.AppendLine("Cold storage utilisation");
        report.AppendLine("Hazmat cage utilisation");
        report.AppendLine("Section 7. Labour");
        report.AppendLine("Picker hours scheduled");
        report.AppendLine("Picker hours worked");
        report.AppendLine("Packer hours scheduled");
        report.AppendLine("Packer hours worked");
        report.AppendLine("Overtime hours approved");
        report.AppendLine("Section 8. Quality");
        report.AppendLine("Mispicks reported");
        report.AppendLine("Mispacks reported");
        report.AppendLine("Labels reprinted");
        report.AppendLine("Audits passed");
        report.AppendLine("Section 9. Finance");
        report.AppendLine("Freight spend for the month");
        report.AppendLine("Packaging spend for the month");
        report.AppendLine("Insurance premiums accrued");
        report.AppendLine("Customs duties accrued");
        report.AppendLine("Section 10. Sign-off");
        report.AppendLine("Reviewed by shift supervisors");
        report.AppendLine("Approved by the operations manager");
        report.AppendLine("Filed with the finance archive");
        report.AppendLine("Distribution list updated");
        report.AppendLine("End of statement");
        return report.ToString();
    }

    // VIOLATION: code-quality/deterministic/too-many-breaks
    internal int ScanForTerminator(List<string> tokens)
    {
        var index = 0;
        while (index < tokens.Count)
        {
            if (tokens[index] == "EOF")
            {
                break;
            }
            if (tokens[index] == "HALT")
            {
                break;
            }
            if (tokens[index] == "ABORT")
            {
                break;
            }
            if (tokens[index] == "RESET")
            {
                break;
            }
            if (tokens[index] == "FLUSH")
            {
                break;
            }
            if (tokens[index] == "PURGE")
            {
                break;
            }
            index++;
        }
        return index;
    }

    internal int PlanRetryBudget(int ceiling)
    {
        int OuterWindow(int remaining)
        {
            int MiddleWindow(int step)
            {
                // VIOLATION: code-quality/deterministic/deeply-nested-functions
                int InnerWindow(int slice)
                {
                    return slice + step;
                }
                return InnerWindow(step) + remaining;
            }
            return MiddleWindow(remaining);
        }
        return OuterWindow(ceiling);
    }
}
