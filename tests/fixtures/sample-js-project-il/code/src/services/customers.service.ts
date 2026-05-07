import { randomUUID } from 'node:crypto';
import type { Customer } from '../types.js';
import { customersRepo } from '../repos/customers.repo.js';

export const customersService = {
  async create(input: { email: string; name: string }): Promise<{ ok: true; customer: Customer } | { ok: false; reason: 'email_taken' }> {
    // IL-DRIFT: Entity:Customer / field.email.normalize
    // Spec says email is lowercased on write. We store raw input, so two
    // customers with `Foo@Example.com` and `foo@example.com` would not be
    // detected as duplicates and downstream lookups by lowercase email
    // would miss this row.
    const email = input.email;
    const existing = await customersRepo.findByEmail(email);
    if (existing) return { ok: false, reason: 'email_taken' };
    const c: Customer = {
      id: randomUUID(),
      email,
      name: input.name,
      loyaltyTier: 'standard',
      createdAt: new Date().toISOString(),
    };
    await customersRepo.insert(c);
    return { ok: true, customer: c };
  },
};
