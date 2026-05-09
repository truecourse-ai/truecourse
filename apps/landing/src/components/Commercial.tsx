import { useState } from 'react';
import { ArrowRight, Check, Github, Loader2, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';

const PERKS = [
  {
    icon: Github,
    title: 'GitHub-native PR review',
    body: 'Install the GitHub App once. Every PR gets reviewed automatically with line-by-line comments on hallucinations, fabricated APIs, and drift. Merge-blocking on critical findings, optional.',
  },
  {
    icon: Users,
    title: 'Team &amp; per-engineer insights',
    body: 'See who&apos;s shipping, what&apos;s drifting, and where each engineer needs support. AI-generated ratio, drift caught at PR, findings escaped to main &mdash; per engineer, per team.',
  },
  {
    icon: Sparkles,
    title: 'Business-logic drift baselines',
    body: 'Encode your specs once. Every AI-generated change is checked against them automatically. Drift gets surfaced before it lands.',
  },
  {
    icon: ShieldCheck,
    title: 'SSO &amp; audit logs',
    body: 'SAML, SCIM, RBAC. The compliance controls you need to put TrueCourse on the path of every AI-written commit.',
  },
];

export function Commercial() {
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [size, setSize] = useState<string>('');
  // Honeypot — humans never see/touch this; bots usually fill any text input.
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
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      setState('done');
    } catch {
      setState('error');
      setError('Could not submit right now. Try again in a moment.');
    }
  };

  return (
    <section id="waitlist" className="relative scroll-mt-24 border-b border-border py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          {/* Left: pitch + perks */}
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
              The teams plan
            </p>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Validate every line your AI ships.
              <span className="block text-muted-foreground">Across every repo, every PR.</span>
            </h2>
            <p className="mt-5 text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
              PR review for AI-generated changes, business-logic drift baselines, org-wide
              dashboards, SSO, audit logs, and a hosted control plane you don&apos;t have
              to babysit. Drop your details and we&apos;ll be in touch when a slot opens.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {PERKS.map((p) => (
                <div
                  key={p.title}
                  className="surface rounded-xl border border-border p-4 transition-colors hover:border-border-strong"
                >
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background/60 text-accent">
                    <p.icon className="h-4 w-4" />
                  </span>
                  <h3
                    className="mt-3 text-sm font-semibold"
                    dangerouslySetInnerHTML={{ __html: p.title }}
                  />
                  <p
                    className="mt-1.5 text-xs leading-relaxed text-muted-foreground"
                    dangerouslySetInnerHTML={{ __html: p.body }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Right: waitlist form */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <div className="glow-border surface rounded-2xl border border-border p-6 shadow-2xl shadow-black/40 sm:p-8">
              {state === 'done' ? (
                <SuccessState email={email} />
              ) : (
                <>
                  <h3 className="text-xl font-semibold">Join the waitlist</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    We&apos;re onboarding teams in waves. Drop your details and we&apos;ll
                    be in touch when a slot opens.
                  </p>

                  <form onSubmit={onSubmit} className="mt-6 space-y-4">
                    {/* Honeypot — hidden from users, attractive to spam bots */}
                    <div
                      aria-hidden
                      style={{
                        position: 'absolute',
                        left: '-10000px',
                        width: '1px',
                        height: '1px',
                        overflow: 'hidden',
                      }}
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
                        className="block w-full rounded-lg border border-border bg-background/60 px-3.5 py-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-accent focus:ring-2 focus:ring-accent/30"
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
                        className="block w-full rounded-lg border border-border bg-background/60 px-3.5 py-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-accent focus:ring-2 focus:ring-accent/30"
                      />
                    </Field>
                    <Field label="Team size" htmlFor="size">
                      <select
                        id="size"
                        value={size}
                        onChange={(e) => setSize(e.target.value)}
                        className="block w-full rounded-lg border border-border bg-background/60 px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30"
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
                        'inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-accent/40 bg-accent/15 px-4 text-sm font-medium text-foreground transition-all hover:border-accent/60 hover:bg-accent/25',
                        state === 'submitting'
                          ? 'cursor-not-allowed opacity-70'
                          : 'hover:-translate-y-0.5',
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
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="block">
      <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function SuccessState({ email }: { email: string }) {
  return (
    <div className="text-center">
      <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
        <Check className="h-6 w-6" />
      </div>
      <h3 className="mt-4 text-xl font-semibold">You&apos;re on the list</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        We&apos;ll reach out to{' '}
        <span className="font-medium text-foreground">{email}</span> as soon as a slot opens
        in the next onboarding wave. In the meantime, the open source CLI is yours to use today.
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
