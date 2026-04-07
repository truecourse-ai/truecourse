/**
 * UserForm — create/edit user form component.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';

interface User {
  id?: string;
  name: string;
  email: string;
  role: string;
}

interface UserFormProps {
  initialUser?: User;
  onSubmit: (user: User) => Promise<void>;
  onCancel: () => void;
  roles: string[];
}

// VIOLATION: performance/deterministic/missing-react-memo
export function UserForm({ initialUser, onSubmit, onCancel, roles }: UserFormProps) {
  const [name, setName] = useState(initialUser?.name ?? '');
  const [email, setEmail] = useState(initialUser?.email ?? '');
  const [role, setRole] = useState(initialUser?.role ?? 'user');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // VIOLATION: performance/deterministic/missing-usememo-expensive
  const filteredRoles = roles.filter((r) => r !== 'superadmin');

  // VIOLATION: code-quality/deterministic/missing-return-type
  function validate() {
    const newErrors: Record<string, string> = {};
    // VIOLATION: code-quality/deterministic/magic-number
    if (name.length < 3) {
      newErrors.name = 'Name must be at least 3 characters';
    }
    if (!email.includes('@')) {
      newErrors.email = 'Invalid email address';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  // VIOLATION: code-quality/deterministic/missing-return-type
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    try {
      await onSubmit({ id: initialUser?.id, name, email, role });
    } catch (error) {
      // VIOLATION: reliability/deterministic/console-error-no-context
      console.error(error);
    } finally {
      setSubmitting(false);
    }
  }

  // VIOLATION: performance/deterministic/state-update-in-loop
  useEffect(() => {
    if (initialUser) {
      const fields = ['name', 'email', 'role'] as const;
      for (const field of fields) {
        if (field === 'name') setName(initialUser.name);
        if (field === 'email') setEmail(initialUser.email);
        if (field === 'role') setRole(initialUser.role);
      }
    }
  }, [initialUser]);

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />
        {errors.name && <span className="error">{errors.name}</span>}
      </div>
      <div>
        <label>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} />
        {errors.email && <span className="error">{errors.email}</span>}
      </div>
      <div>
        <label>Role</label>
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          {filteredRoles.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>
      <div>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Saving...' : 'Save'}
        </button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
