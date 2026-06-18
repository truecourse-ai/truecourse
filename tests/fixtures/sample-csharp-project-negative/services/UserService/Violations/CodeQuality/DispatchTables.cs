namespace UserServiceApp.Violations.CodeQuality;

internal class DispatchTables
{
    // VIOLATION: code-quality/deterministic/too-many-switch-cases
    // VIOLATION: code-quality/deterministic/cyclomatic-complexity
    // VIOLATION: code-quality/deterministic/too-many-branches
    internal string ResolveShippingZone(string countryCode)
    {
        var zone = "";
        switch (countryCode)
        {
            case "US":
                zone = "na-east";
                break;
            case "CA":
                zone = "na-north";
                break;
            case "MX":
                zone = "na-south";
                break;
            case "BR":
                zone = "sa-core";
                break;
            case "DE":
                zone = "eu-central";
                break;
            case "FR":
                zone = "eu-west";
                break;
            case "ES":
                zone = "eu-iberia";
                break;
            case "IT":
                zone = "eu-south";
                break;
            case "JP":
                zone = "apac-north";
                break;
            case "AU":
                zone = "apac-south";
                break;
            case "NZ":
                zone = "apac-islands";
                break;
            default:
                zone = "unzoned";
                break;
        }
        return zone;
    }

    internal string ResolveCarrierDesk(string carrier, string serviceLevel)
    {
        var desk = "front-desk";
        switch (carrier)
        {
            case "northwind":
                // VIOLATION: code-quality/deterministic/nested-switch
                switch (serviceLevel)
                {
                    case "express":
                        desk = "northwind-express-desk";
                        break;
                    case "ground":
                        desk = "northwind-ground-desk";
                        break;
                    default:
                        desk = "northwind-general-desk";
                        break;
                }
                break;
            case "coastal":
                desk = "coastal-desk";
                break;
            default:
                desk = "partner-desk";
                break;
        }
        return desk;
    }

    internal string ResolveReturnBin(string condition)
    {
        var bin = "inspection-bin";
        // VIOLATION: code-quality/deterministic/trivial-switch
        switch (condition)
        {
            case "sealed":
                bin = "restock-bin";
                break;
            default:
                bin = "triage-bin";
                break;
        }
        return bin;
    }

    internal string ResolvePriorityLane(string tier)
    {
        var lane = "bulk-lane";
        switch (tier)
        {
            case "platinum":
                lane = "white-glove-lane";
                break;
            // VIOLATION: code-quality/deterministic/default-case-last
            default:
                lane = "standard-lane";
                break;
            case "gold":
                lane = "expedited-lane";
                break;
        }
        return lane;
    }

    internal string ResolveDockDoor(string trailerType)
    {
        var door = "door-zero";
        // VIOLATION: code-quality/deterministic/default-case-in-switch
        switch (trailerType)
        {
            case "reefer":
                door = "cold-door";
                break;
            case "flatbed":
                door = "side-door";
                break;
            case "box":
                door = "main-door";
                break;
        }
        return door;
    }
}
