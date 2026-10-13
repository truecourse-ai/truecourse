import { useState } from 'react';
import type { FormEvent } from 'react';
import { cn } from '@/lib/cn';
import { distinctId, trackEvent } from '@/lib/posthog';
import { trackAdsLeadForm } from '@/lib/ga';
import { trackRedditLead } from '@/lib/reddit';
import { BookLink } from '@/builders/BookLink';
import type { BookPlacement } from '@/builders/BookLink';

/**
 * A question in the hero that the visitor answers instead of booking a call
 * right away: they pick any of the answers, may add their own words, and
 * leave an email. It posts to /api/answer, which records the answer
 * server-side as `cto_need_shared` with the question's id, tied to this visit and the ad it came
 * from; once it has gone through it counts as a lead in Google Ads and Reddit
 * Ads. Booking a call stays one tap away, before and after sending.
 */

export type Question = {
  /** The question's id. The same ids, with their answers, are in api/answer.ts. */
  id: 'cto-need' | 'app-worry';
  ask: string;
  answers: { id: string; label: string }[];
  /** Whether to offer a box for their own words. */
  note?: boolean;
  /** Where the "Rather talk?" link sits, for `book_checkup_clicked`. */
  placement: BookPlacement;
};

export const CTO_NEED: Question = {
  id: 'cto-need',
  ask: 'What do you need a CTO for?',
  answers: [
    { id: 'build', label: 'Build or finish the app' },
    { id: 'fix', label: 'Fix what keeps breaking' },
    { id: 'strategy', label: 'Tech decisions and strategy' },
    { id: 'developers', label: 'Manage developers' },
    { id: 'security', label: 'Security and reliability' },
    { id: 'other', label: 'Something else' },
  ],
  note: true,
  placement: 'hero',
};

export const APP_WORRY: Question = {
  id: 'app-worry',
  ask: 'What worries you most about your app?',
  answers: [
    { id: 'bugs', label: 'Bugs after every change' },
    { id: 'night', label: 'It breaks at night' },
    { id: 'stuck', label: 'Users get stuck' },
    { id: 'security', label: 'Security' },
    { id: 'other', label: 'Something else' },
  ],
  placement: 'hero',
};

const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

type State = 'idle' | 'sending' | 'done' | 'failed';

export function AskForm({ question, className }: { question: Question; className?: string }) {
  const [needs, setNeeds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>('idle');

  const toggle = (id: string) => {
    // The first answer picked, so a started but unsent form shows up.
    if (needs.length === 0) trackEvent('cto_need_started', { need: id, question: question.id });
    setNeeds(needs.includes(id) ? needs.filter((n) => n !== id) : [...needs, id]);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState('sending');
    const params = new URLSearchParams(window.location.search);
    const utm = Object.fromEntries(UTM.flatMap((k) => (params.get(k) ? [[k, params.get(k)]] : [])));
    try {
      const res = await fetch('/api/answer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question: question.id,
          needs,
          note,
          email,
          visitor: distinctId(),
          page: window.location.pathname,
          utm,
        }),
      });
      if (res.ok) {
        trackAdsLeadForm();
        trackRedditLead();
      }
      setState(res.ok ? 'done' : 'failed');
    } catch {
      setState('failed');
    }
  };

  if (state === 'done') {
    return (
      <div className={cn('bs-need bs-need-done', className)} id="ask">
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
    <form className={cn('bs-need', className)} id="ask" onSubmit={submit}>
      <b className="bs-need-q">{question.ask}</b>
      <p className="bs-need-hint">Pick any that fit.</p>
      <div className="bs-need-chips">
        {question.answers.map((a) => (
          <button
            type="button"
            key={a.id}
            className={cn('bs-need-chip', needs.includes(a.id) && 'on')}
            aria-pressed={needs.includes(a.id)}
            onClick={() => toggle(a.id)}
          >
            {a.label}
          </button>
        ))}
      </div>
      {question.note && (
        <textarea
          className="bs-need-note"
          rows={2}
          maxLength={2000}
          placeholder="In your own words (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      )}
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
        <BookLink className="bs-need-call" placement={question.placement}>
          Book a free 30-minute call
        </BookLink>
      </p>
    </form>
  );
}
