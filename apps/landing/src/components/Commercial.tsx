import { ArrowRight, Github, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { Link } from 'react-router-dom';

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
  return (
    <section id="access" className="relative scroll-mt-24 border-b border-border py-24 sm:py-32">
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

          {/* Right: CTA */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <div className="glow-border surface rounded-2xl border border-border p-6 shadow-2xl shadow-black/40 sm:p-8">
              <h3 className="text-xl font-semibold">Ready to get started?</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Teams is in closed beta and we&apos;re onboarding new orgs in waves.
                Drop your details and we&apos;ll be in touch when the next batch opens.
              </p>
              <Link
                to="/request-access"
                className="group mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-accent/40 bg-accent/15 px-4 text-sm font-medium text-foreground transition-all hover:-translate-y-0.5 hover:border-accent/60 hover:bg-accent/25"
              >
                Request access
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

