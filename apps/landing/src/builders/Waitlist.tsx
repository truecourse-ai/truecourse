import { useState } from 'react';
import type { FormEvent } from 'react';
import { distinctId } from '@/lib/posthog';

type State = 'idle' | 'sending' | 'done' | 'failed';

/**
 * The lighter ask under the app checkup: joining the waitlist. It posts to
 * /api/waitlist, which records the signup server-side and ties it to this
 * visit.
 */
export function Waitlist() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>('idle');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState('sending');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, visitor: distinctId() }),
      });
      setState(res.ok ? 'done' : 'failed');
    } catch {
      setState('failed');
    }
  };

  if (state === 'done') {
    return (
      <p className="bs-waitlist-done">
        You're on the list. We bring builders on a few at a time, and we'll email you when there's room for you.
      </p>
    );
  }

  return (
    <form className="bs-waitlist" onSubmit={submit}>
      <label htmlFor="bs-waitlist-email">Not ready yet? Join the waitlist.</label>
      <div className="bs-waitlist-row">
        <input
          id="bs-waitlist-email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@yourfirm.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button type="submit" className="btn" disabled={state === 'sending'}>
          {state === 'sending' ? 'Joining…' : 'Join the waitlist'}
        </button>
      </div>
      {state === 'failed' && (
        <p className="bs-waitlist-failed">
          That didn't go through. Try again, or email <a href="mailto:mushegh@truecourse.dev">mushegh@truecourse.dev</a>.
        </p>
      )}
    </form>
  );
}
