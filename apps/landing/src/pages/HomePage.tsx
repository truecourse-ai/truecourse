import { Hero } from '@/components/Hero';
import { WhyNow } from '@/components/WhyNow';
import { OurApproach } from '@/components/OurApproach';
import { WhereItRuns } from '@/components/WhereItRuns';
import { Integrations } from '@/components/Integrations';
import { Enterprise } from '@/components/Enterprise';
import { BlogTeaser } from '@/components/BlogTeaser';
import { CTASection } from '@/components/CTASection';

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
