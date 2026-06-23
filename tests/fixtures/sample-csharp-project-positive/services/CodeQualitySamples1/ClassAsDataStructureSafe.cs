namespace Positive.Boundary.CodeQuality;

/// <summary>Builds a coordinate container that uses auto-properties, not bare fields.</summary>
public sealed class ClassAsDataStructureSafe
{
    /// <summary>A two-value container exposed through idiomatic auto-properties.</summary>
    internal sealed class Coordinate
    {
        // SAFE: code-quality/deterministic/class-as-data-structure
        public int Latitude { get; set; }

        public int Longitude { get; set; }
    }

    /// <summary>Creates a coordinate from the supplied values.</summary>
    internal Coordinate Make(int latitude, int longitude)
    {
        return new Coordinate { Latitude = latitude, Longitude = longitude };
    }
}
