declare const Link: (props: { href: string; className?: string; children: React.ReactNode }) => JSX.Element;
declare const Button: (props: { children: React.ReactNode; size?: string; variant?: string; asChild?: boolean; className?: string }) => JSX.Element;
declare const Badge: (props: { children: React.ReactNode; className?: string }) => JSX.Element;
declare const cn: (...args: unknown[]) => string;

type HeroSectionProps = {
  headline: string;
  subheadline: string;
  ctaText: string;
  ctaHref: string;
  badgeText?: string;
};

export default function HomePage({
  headline,
  subheadline,
  ctaText,
  ctaHref,
  badgeText,
}: HeroSectionProps) {
  return (
    <main className="flex min-h-screen flex-col">
      <section className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-24 text-center">
        {badgeText && (
          <Badge className="mb-2 rounded-full px-4 py-1 text-sm font-medium">{badgeText}</Badge>
        )}
        <h1 className="max-w-3xl text-4xl font-extrabold tracking-tight sm:text-5xl md:text-6xl">
          {headline}
        </h1>
        <p className="max-w-xl text-lg text-muted-foreground sm:text-xl">{subheadline}</p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button size="lg" asChild>
            <Link href={ctaHref}>{ctaText}</Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/demo">View Demo</Link>
          </Button>
        </div>
      </section>
      <section className="border-t bg-muted/40 px-4 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-8 text-center text-2xl font-bold">Why teams choose us</h2>
          <div className="grid gap-8 sm:grid-cols-3">
            <div className="flex flex-col gap-2 rounded-lg border bg-card p-6 shadow-sm">
              <h3 className="font-semibold">Fast setup</h3>
              <p className="text-sm text-muted-foreground">
                Get started in minutes with no configuration required.
              </p>
            </div>
            <div className="flex flex-col gap-2 rounded-lg border bg-card p-6 shadow-sm">
              <h3 className="font-semibold">Secure by default</h3>
              <p className="text-sm text-muted-foreground">
                End-to-end encryption and audit logs on every action.
              </p>
            </div>
            <div className="flex flex-col gap-2 rounded-lg border bg-card p-6 shadow-sm">
              <h3 className="font-semibold">Open source</h3>
              <p className="text-sm text-muted-foreground">
                Self-host or use our cloud. Full transparency, no vendor lock-in.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
