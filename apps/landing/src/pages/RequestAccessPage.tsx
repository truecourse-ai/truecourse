import { useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { AccessForm } from '@/components/AccessForm';

export default function RequestAccessPage() {
  useEffect(() => {
    const prev = document.title;
    document.title = 'TrueCourse · Request access';
    return () => {
      document.title = prev;
    };
  }, []);

  return (
    <section className="relative isolate flex min-h-screen items-start justify-center overflow-hidden px-4 pt-32 pb-16 sm:px-6">
      <div className="bg-radial-glow absolute inset-0 -z-10" />
      <div className="bg-grid absolute inset-0 -z-10" />

      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-medium text-accent backdrop-blur-md">
            <Sparkles className="h-3 w-3" />
            Closed beta
          </div>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">
            Request early access
          </h1>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            We&apos;re onboarding teams in waves. Drop your details and we&apos;ll be in touch
            when the next batch opens.
          </p>
        </div>

        <div className="glow-border surface rounded-2xl border border-border p-6 shadow-2xl shadow-black/40">
          <AccessForm />
        </div>
      </div>
    </section>
  );
}
