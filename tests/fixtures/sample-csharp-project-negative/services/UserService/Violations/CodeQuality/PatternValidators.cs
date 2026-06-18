using System.Text.RegularExpressions;

namespace UserServiceApp.Violations.CodeQuality;

internal static class PatternValidators
{
    // VIOLATION: code-quality/deterministic/regex-unused-group
    private static readonly Regex PhoneMask = new Regex(@"(?<area>\d{3})-(?<exchange>\d{4})");

    internal static string AreaCodeOf(string phone)
    {
        return PhoneMask.Match(phone).Groups["area"].Value;
    }

    internal static bool IsTenderChannel(string channel)
    {
        // VIOLATION: code-quality/deterministic/regex-anchor-precedence
        return Regex.IsMatch(channel, "^cash|card$");
    }

    internal static string ExtractNote(string html)
    {
        // VIOLATION: code-quality/deterministic/regex-char-class-preferred
        return Regex.Match(html, "<note>.*?</note>").Value;
    }

    internal static string SummarizeLogLine(string line)
    {
        // VIOLATION: code-quality/deterministic/regex-complexity
        var stampPattern = new Regex(@"^(?<stamp>(?<date>\d{8})T(?<time>\d{6}))\s\[(?<level>\w+)\]\s(?<message>.+)$");
        var match = stampPattern.Match(line);
        var stamp = match.Groups["stamp"].Value;
        var date = match.Groups["date"].Value;
        var time = match.Groups["time"].Value;
        var level = match.Groups["level"].Value;
        var message = match.Groups["message"].Value;
        return string.Join(" ", stamp, date, time, level, message);
    }

    internal static bool IsBranchCode(string branchCode)
    {
        // VIOLATION: code-quality/deterministic/regex-concise
        return Regex.IsMatch(branchCode, @"^\d\d\d-[A-Z]+$");
    }

    internal static bool HasVowelRun(string vowelToken)
    {
        // VIOLATION: code-quality/deterministic/regex-duplicate-char-class
        return Regex.IsMatch(vowelToken, "[aeioua]+");
    }

    internal static string FindTermsClause(string body)
    {
        // VIOLATION: code-quality/deterministic/regex-empty-after-reluctant
        return Regex.Match(body, @"\w+?\s?terms").Value;
    }

    internal static bool IsKnownTender(string tender)
    {
        // VIOLATION: code-quality/deterministic/regex-empty-alternative
        return Regex.IsMatch(tender, "cash|card|");
    }

    internal static bool IsOrderSlug(string slug)
    {
        // VIOLATION: code-quality/deterministic/regex-empty-group
        return Regex.IsMatch(slug, "order()number");
    }

    internal static bool HasRepeatedSegment(string payload)
    {
        // VIOLATION: code-quality/deterministic/regex-empty-repetition
        var segmentPattern = new Regex("(ab?)+suffix");
        return segmentPattern.IsMatch(payload);
    }

    internal static bool IsAlignedReportHeader(string header)
    {
        // VIOLATION: code-quality/deterministic/regex-multiple-spaces
        return Regex.IsMatch(header, @"report:  \d+");
    }

    internal static bool IsFlagAssignment(string flagLine)
    {
        // VIOLATION: code-quality/deterministic/regex-octal-escape
        return Regex.IsMatch(flagLine, @"^flag\042set$");
    }

    internal static bool IsPromptAnswer(string answer)
    {
        // VIOLATION: code-quality/deterministic/regex-single-char-alternation
        return Regex.IsMatch(answer, "(y|n|q)");
    }

    internal static bool IsWeightUnit(string unit)
    {
        // VIOLATION: code-quality/deterministic/regex-single-char-class
        return Regex.IsMatch(unit, "gram[s]");
    }

    internal static bool IsVersionTag(string version)
    {
        // VIOLATION: code-quality/deterministic/regex-superfluous-quantifier
        return Regex.IsMatch(version, @"v\d+\.\d{1}");
    }

    internal static bool IsReadRoute(string requestLine)
    {
        // VIOLATION: code-quality/deterministic/regex-unnecessary-non-capturing-group
        return Regex.IsMatch(requestLine, "(?:GET) /api/users");
    }

    internal static string PartNumberRoot(string partNumber)
    {
        // VIOLATION: code-quality/deterministic/unnamed-regex-capture
        var partPattern = new Regex(@"(\d+)-(\d+)-(\d+)");
        return partPattern.Match(partNumber).Groups[1].Value;
    }

    internal static bool MentionsPendingRefund(string comment)
    {
        // VIOLATION: code-quality/deterministic/unnecessary-regular-expression
        return Regex.IsMatch(comment, "refund pending");
    }
}
