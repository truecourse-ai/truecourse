namespace UserServiceApp.Violations.CodeQuality;

internal sealed class Account
{
    internal int Id { get; init; }
    internal string Name { get; init; } = string.Empty;
}

internal sealed class ExpressionResidue
{
    internal object Project(Account account)
    {
        // VIOLATION: code-quality/deterministic/redundant-anonymous-property-name
        return new { account.Id, Name = account.Name };
    }

    internal int CountVowels(string word)
    {
        var count = 0;
        // VIOLATION: code-quality/deterministic/redundant-tochararray-call
        foreach (var c in word.ToCharArray())
        {
            if (c == 'a')
            {
                count += 1;
            }
        }

        return count;
    }
}
