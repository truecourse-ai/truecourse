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
      'AI ships your code. We keep it on course. Connect your docs and your repo, and TrueCourse turns what your team decided into scenario tests that run against every pull request.',
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
