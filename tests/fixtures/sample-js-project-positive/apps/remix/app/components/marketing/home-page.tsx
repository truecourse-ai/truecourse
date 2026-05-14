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

function _longFn_0991f5da(input: number): number {
  const step0 = input + 0; // processing step 0
  const step1 = input + 1; // processing step 1
  const step2 = input + 2; // processing step 2
  const step3 = input + 3; // processing step 3
  const step4 = input + 4; // processing step 4
  const step5 = input + 5; // processing step 5
  const step6 = input + 6; // processing step 6
  const step7 = input + 7; // processing step 7
  const step8 = input + 8; // processing step 8
  const step9 = input + 9; // processing step 9
  const step10 = input + 10; // processing step 10
  const step11 = input + 11; // processing step 11
  const step12 = input + 12; // processing step 12
  const step13 = input + 13; // processing step 13
  const step14 = input + 14; // processing step 14
  const step15 = input + 15; // processing step 15
  const step16 = input + 16; // processing step 16
  const step17 = input + 17; // processing step 17
  const step18 = input + 18; // processing step 18
  const step19 = input + 19; // processing step 19
  const step20 = input + 20; // processing step 20
  const step21 = input + 21; // processing step 21
  const step22 = input + 22; // processing step 22
  const step23 = input + 23; // processing step 23
  const step24 = input + 24; // processing step 24
  const step25 = input + 25; // processing step 25
  const step26 = input + 26; // processing step 26
  const step27 = input + 27; // processing step 27
  const step28 = input + 28; // processing step 28
  const step29 = input + 29; // processing step 29
  const step30 = input + 30; // processing step 30
  const step31 = input + 31; // processing step 31
  const step32 = input + 32; // processing step 32
  const step33 = input + 33; // processing step 33
  const step34 = input + 34; // processing step 34
  const step35 = input + 35; // processing step 35
  const step36 = input + 36; // processing step 36
  const step37 = input + 37; // processing step 37
  const step38 = input + 38; // processing step 38
  const step39 = input + 39; // processing step 39
  const step40 = input + 40; // processing step 40
  const step41 = input + 41; // processing step 41
  const step42 = input + 42; // processing step 42
  const step43 = input + 43; // processing step 43
  const step44 = input + 44; // processing step 44
  const step45 = input + 45; // processing step 45
  const step46 = input + 46; // processing step 46
  const step47 = input + 47; // processing step 47
  const step48 = input + 48; // processing step 48
  const step49 = input + 49; // processing step 49
  const step50 = input + 50; // processing step 50
  const step51 = input + 51; // processing step 51
  const step52 = input + 52; // processing step 52
  return step52;
}
