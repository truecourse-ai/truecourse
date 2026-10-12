import { useState } from 'react';
import type { FormEvent } from 'react';
import { cn } from '@/lib/cn';
import { distinctId, trackEvent } from '@/lib/posthog';
import { BookLink } from '@/builders/BookLink';

/**
 * The hero's question on /fractional-cto: what the visitor needs from a CTO.
 * They pick any of the needs, may add their own words, and leave an email.
 * It posts to /api/cto-need, which records the answer server-side as
 * `cto_need_shared`, tied to this visit and the ad it came from. Booking a
 * call stays one tap away, before and after sending.
 */

/** The needs offered, by id. The same ids are in api/cto-need.ts. */
const NEEDS: { id: string; label: string }[] = [
  { id: 'build', label: 'Build or finish the app' },
  { id: 'fix', label: 'Fix what keeps breaking' },
  { id: 'strategy', label: 'Tech decisions and strategy' },
  { id: 'developers', label: 'Manage developers' },
  { id: 'security', label: 'Security and reliability' },
  { id: 'other', label: 'Something else' },
];

const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

type State = 'idle' | 'sending' | 'done' | 'failed';

export function NeedForm() {
  const [needs, setNeeds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>('idle');

  const toggle = (id: string) => {
    if (needs.length === 0) trackEvent('cto_need_started', { need: id });
    setNeeds(needs.includes(id) ? needs.filter((n) => n !== id) : [...needs, id]);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState('sending');
    const params = new URLSearchParams(window.location.search);
    const utm = Object.fromEntries(UTM.flatMap((k) => (params.get(k) ? [[k, params.get(k)]] : [])));
    try {
      const res = await fetch('/api/cto-need', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ needs, note, email, visitor: distinctId(), page: window.location.pathname, utm }),
      });
      setState(res.ok ? 'done' : 'failed');
    } catch {
      setState('failed');
    }
  };

  if (state === 'done') {
    return (
      <div className="bs-need bs-need-done" id="need">
        <b>Thanks, we have it.</b>
        <p>We will read it today and email you how your AI CTO would handle it.</p>
        <BookLink className="btn btn-primary" placement="need-form">
          Talk it through on a free call
        </BookLink>
      </div>
    );
  }

  const ready = (needs.length > 0 || note.trim() !== '') && email.trim() !== '';

  return (
    <form className="bs-need" id="need" onSubmit={submit}>
      <b className="bs-need-q">What do you need a CTO for?</b>
      <p className="bs-need-hint">Pick any that fit.</p>
      <div className="bs-need-chips">
        {NEEDS.map((n) => (
          <button
            type="button"
            key={n.id}
            className={cn('bs-need-chip', needs.includes(n.id) && 'on')}
            aria-pressed={needs.includes(n.id)}
            onClick={() => toggle(n.id)}
          >
            {n.label}
          </button>
        ))}
      </div>
      <textarea
        className="bs-need-note"
        rows={2}
        maxLength={2000}
        placeholder="In your own words (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="bs-need-row">
        <input
          type="email"
          required
          autoComplete="email"
          placeholder="you@yourcompany.com"
          aria-label="Your email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={!ready || state === 'sending'}>
          {state === 'sending' ? 'Sending…' : 'Send'}
        </button>
      </div>
      {state === 'failed' && (
        <p className="bs-need-failed">
          That didn't go through. Try again, or email <a href="mailto:mushegh@truecourse.dev">mushegh@truecourse.dev</a>.
        </p>
      )}
      <p className="bs-need-or">
        Rather talk?{' '}
        <BookLink className="bs-need-call" placement="hero">
          Book a free 30-minute call
        </BookLink>
      </p>
    </form>
  );
}
