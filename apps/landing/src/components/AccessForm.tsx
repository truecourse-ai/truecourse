import { useState } from 'react';
import { identifyUser, trackEvent } from '@/lib/posthog';

const GITHUB_URL = 'https://github.com/truecourse-ai/truecourse';

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
    if (website) return; // honeypot
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
      <div className="success">
        <div className="check">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h3>Request received</h3>
        <p>
          We&apos;ll reach out to <span className="email">{email}</span> when the next batch
          of teams gets access. In the meantime, the open-source CLI is yours to use today.
        </p>
        <a className="btn btn-sm" style={{ marginTop: 22 }} href={GITHUB_URL}>
          Try the open-source CLI <span className="arr">→</span>
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      {/* honeypot */}
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

      {error && <div className="form-error">{error}</div>}

      <label className="field" htmlFor="email">
        <span className="flabel">Work email</span>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          autoComplete="email"
        />
      </label>
      <label className="field" htmlFor="company">
        <span className="flabel">Company</span>
        <input
          id="company"
          type="text"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="Acme Inc."
          autoComplete="organization"
        />
      </label>
      <label className="field" htmlFor="size">
        <span className="flabel">Team size</span>
        <select id="size" value={size} onChange={(e) => setSize(e.target.value)}>
          <option value="">Select…</option>
          <option value="1-10">1 – 10 engineers</option>
          <option value="11-50">11 – 50</option>
          <option value="51-200">51 – 200</option>
          <option value="200+">200+</option>
        </select>
      </label>

      <button type="submit" className="btn btn-primary btn-block" disabled={state === 'submitting'}>
        {state === 'submitting' ? (
          <>
            <span className="spinner" />
            <span className="btn-label">Submitting…</span>
          </>
        ) : (
          <>
            <span className="btn-label">Request access</span>
            <span className="arr">→</span>
          </>
        )}
      </button>
      <p className="form-note">
        We&apos;ll only use your email to talk about TrueCourse. No newsletters.
      </p>
    </form>
  );
}
