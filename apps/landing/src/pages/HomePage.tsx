import { pageMeta } from '@/lib/seo';
import { Hero } from '@/components/Hero';
import { WhyNow } from '@/components/WhyNow';
import { OurApproach } from '@/components/OurApproach';
import { WhereItRuns } from '@/components/WhereItRuns';
import { Integrations } from '@/components/Integrations';
import { Enterprise } from '@/components/Enterprise';
import { BlogTeaser } from '@/components/BlogTeaser';
import { CTASection } from '@/components/CTASection';

export const meta = () =>
  pageMeta({
    title: 'TrueCourse · Keep your code on course',
    description:
      "AI ships your code. We keep it on course. TrueCourse compiles your team's decisions into machine-readable contracts and checks every change against them — deterministically, with no LLM in the verification loop.",
    path: '/',
  });

export default function HomePage() {
  return (
    <>
      <Hero />
      <WhyNow />
      <OurApproach />
      <WhereItRuns />
      <Integrations />
      <Enterprise />
      <BlogTeaser />
      <CTASection />
    </>
  );
}
