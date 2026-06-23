using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore;

namespace UserServiceApp.Violations.Performance;

internal sealed class OutboxFlusher
{
    private readonly OutboxDbContext _db;

    internal OutboxFlusher(OutboxDbContext db)
    {
        _db = db;
    }

    internal void MarkDispatched(IReadOnlyList<OutboxMessage> messages)
    {
        foreach (var message in messages)
        {
            // VIOLATION: code-quality/deterministic/non-testable-datetime-provider
            message.DispatchedAt = DateTime.UtcNow;
            _db.Outbox.Update(message);
            // VIOLATION: performance/deterministic/batch-writes-in-loop
            _db.SaveChanges();
        }
    }
}
