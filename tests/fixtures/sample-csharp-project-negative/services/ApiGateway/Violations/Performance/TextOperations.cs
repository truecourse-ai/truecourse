using System;
using System.IO;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace ApiGateway.Violations.Performance;

internal sealed class TextOperations
{
    internal bool IsSku(string candidate)
    {
        // VIOLATION: performance/deterministic/prefer-regex-ismatch
        return Regex.Match(candidate, "^[A-Z]{3}-").Success;
    }

    internal int WordCount(string text)
    {
        // VIOLATION: performance/deterministic/prefer-regex-count
        return Regex.Matches(text, @"\w+").Count;
    }

    internal bool SameName(string left, string right)
    {
        // VIOLATION: performance/deterministic/tolower-for-comparison
        return left.ToLower() == right.ToLower();
    }

    internal string Fingerprint(byte[] digest)
    {
        // VIOLATION: performance/deterministic/use-tohexstring
        return BitConverter.ToString(digest).Replace("-", "").ToLowerInvariant();
    }

    internal string ResolvePath(string root, string folder, string file)
    {
        // VIOLATION: performance/deterministic/nested-path-combine
        return Path.Combine(root, Path.Combine(folder, file));
    }

    internal int ItemCount(string json)
    {
        try
        {
            // VIOLATION: performance/deterministic/jsondocument-rootelement
            return JsonDocument.Parse(json).RootElement.GetArrayLength();
        }
        catch (JsonException)
        {
            return 0;
        }
    }

    internal string Render(object payload)
    {
        // VIOLATION: performance/deterministic/local-jsonserializeroptions
        return JsonSerializer.Serialize(payload, new JsonSerializerOptions { WriteIndented = true });
    }
}
