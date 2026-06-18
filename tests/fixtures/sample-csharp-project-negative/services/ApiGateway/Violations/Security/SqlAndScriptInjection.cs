using System.Collections.Generic;
using System.Data;
using System.Threading.Tasks;
using Dapper;
using Microsoft.CodeAnalysis.CSharp.Scripting;

namespace ApiGateway.Violations.Security;

internal sealed class SqlAndScriptInjection
{
    internal IEnumerable<User> FindByName(IDbConnection connection, string name)
    {
        // VIOLATION: security/deterministic/sql-injection
        return connection.Query<User>($"SELECT Id, Name FROM Users WHERE Name = '{name}'");
    }

    internal string BuildLookupQuery(string tenant)
    {
        // VIOLATION: security/deterministic/hardcoded-sql-expression
        return string.Format("SELECT Id FROM Accounts WHERE Tenant = '{0}'", tenant);
    }

    internal Task<object> EvaluateExpression(string expression)
    {
        // VIOLATION: security/deterministic/eval-usage
        return CSharpScript.EvaluateAsync<object>(expression);
    }
}
