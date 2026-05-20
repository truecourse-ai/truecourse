import { useState } from 'react';
import { ArrowRight, Check, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { identifyUser, trackEvent } from '@/lib/posthog';
import { cn } from '@/lib/cn';

export function AccessForm() {
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [size, setSize] = useState('');
  const [website, setWebsite] = useState('');
  const [state, setState] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !email.includes('@')) {
      setError('Please enter a valid work email.');
      return;
    }
    setState('submitting');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, company, size, website }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      identifyUser(email, { company, team_size: size });
      trackEvent('waitlist_submitted', {
        team_size: size || 'unspecified',
        has_company: Boolean(company),
      });
      setState('done');
    } catch {
      setState('error');
      setError('Could not submit right now. Try again in a moment.');
    }
  };

  if (state === 'done') {
    return (
      <div className="text-center">
        <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
          <Check className="h-6 w-6" />
        </div>
        <h3 className="mt-4 text-xl font-semibold">Request received</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          We&apos;ll reach out to{' '}
          <span className="font-medium text-foreground">{email}</span> when the next batch
          of teams gets access. In the meantime, the open source CLI is yours to use today.
        </p>
        <Link
          to="/#open-source"
          className="mt-6 inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:border-border-strong"
        >
          Try the open source CLI
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* Honeypot */}
      <div
        aria-hidden
        style={{ position: 'absolute', left: '-10000px', width: '1px', height: '1px', overflow: 'hidden' }}
      >
        <label htmlFor="website">Website (leave empty)</label>
        <input
          id="website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      <Field label="Work email" htmlFor="email">
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          autoComplete="email"
          className="block w-full rounded-lg border border-border bg-background/60 px-4 py-3 text-base outline-none transition-colors placeholder:text-muted-foreground focus:border-accent focus:ring-2 focus:ring-accent/30"
        />
      </Field>
      <Field label="Company" htmlFor="company">
        <input
          id="company"
          type="text"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="Acme Inc."
          autoComplete="organization"
          className="block w-full rounded-lg border border-border bg-background/60 px-4 py-3 text-base outline-none transition-colors placeholder:text-muted-foreground focus:border-accent focus:ring-2 focus:ring-accent/30"
        />
      </Field>
      <Field label="Team size" htmlFor="size">
        <select
          id="size"
          value={size}
          onChange={(e) => setSize(e.target.value)}
          className="block w-full rounded-lg border border-border bg-background/60 px-4 py-3 text-base outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30"
        >
          <option value="">Select…</option>
          <option value="1-10">1 – 10 engineers</option>
          <option value="11-50">11 – 50</option>
          <option value="51-200">51 – 200</option>
          <option value="200+">200+</option>
        </select>
      </Field>

      {error && (
        <p className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={state === 'submitting'}
        className={cn(
          'inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-accent/40 bg-accent/15 px-4 text-sm font-medium text-foreground transition-all hover:border-accent/60 hover:bg-accent/25',
          state === 'submitting' ? 'cursor-not-allowed opacity-70' : 'hover:-translate-y-0.5',
        )}
      >
        {state === 'submitting' ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Submitting…
          </>
        ) : (
          <>
            Request access
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>
      <p className="text-center text-[11px] text-muted-foreground">
        We&apos;ll only use your email to talk about TrueCourse. No newsletters.
      </p>
    </form>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block">
      <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
