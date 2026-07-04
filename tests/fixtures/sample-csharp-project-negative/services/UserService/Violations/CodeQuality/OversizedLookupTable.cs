namespace UserServiceApp.Violations.CodeQuality;

/// <summary>
/// A hand-written method that has grown far past the line budget by inlining a
/// large lookup table. Unlike a scaffolded migration, this is a genuine
/// maintainability smell: the data belongs in configuration or a resource file,
/// not a 50+ line method body. The rule must still fire here.
/// </summary>
internal sealed class OversizedLookupTable
{
    // VIOLATION: code-quality/deterministic/too-many-lines
    public string Symbol(string code)
    {
        var symbols = new System.Collections.Generic.Dictionary<string, string>
        {
            ["Alpha"] = "a-mark",
            ["Bravo"] = "b-mark",
            ["Charlie"] = "c-mark",
            ["Delta"] = "d-mark",
            ["Echo"] = "e-mark",
            ["Foxtrot"] = "f-mark",
            ["Golf"] = "g-mark",
            ["Hotel"] = "h-mark",
            ["India"] = "i-mark",
            ["Juliet"] = "j-mark",
            ["Kilo"] = "k-mark",
            ["Lima"] = "l-mark",
            ["Mike"] = "m-mark",
            ["November"] = "n-mark",
            ["Oscar"] = "o-mark",
            ["Papa"] = "p-mark",
            ["Quebec"] = "q-mark",
            ["Romeo"] = "r-mark",
            ["Sierra"] = "s-mark",
            ["Tango"] = "t-mark",
            ["Uniform"] = "u-mark",
            ["Victor"] = "v-mark",
            ["Whiskey"] = "w-mark",
            ["Xray"] = "x-mark",
            ["Yankee"] = "y-mark",
            ["Zulu"] = "z-mark",
            ["Zero"] = "n0-mark",
            ["One"] = "n1-mark",
            ["Two"] = "n2-mark",
            ["Three"] = "n3-mark",
            ["Four"] = "n4-mark",
            ["Five"] = "n5-mark",
            ["Six"] = "n6-mark",
            ["Seven"] = "n7-mark",
            ["Eight"] = "n8-mark",
            ["Nine"] = "n9-mark",
            ["Ten"] = "n10-mark",
            ["Eleven"] = "n11-mark",
            ["Twelve"] = "n12-mark",
            ["Thirteen"] = "n13-mark",
            ["Fourteen"] = "n14-mark",
            ["Fifteen"] = "n15-mark",
            ["Sixteen"] = "n16-mark",
            ["Seventeen"] = "n17-mark",
            ["Eighteen"] = "n18-mark",
            ["Nineteen"] = "n19-mark",
            ["Twenty"] = "n20-mark"
        };
        return symbols.TryGetValue(code, out var mark) ? mark : code;
    }
}
