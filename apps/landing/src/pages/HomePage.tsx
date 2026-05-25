import { Hero } from '@/components/Hero';
import { WhyNow } from '@/components/WhyNow';
import { OurApproach } from '@/components/OurApproach';
import { Integrations } from '@/components/Integrations';
import { WhyTestsCantCatch } from '@/components/WhyTestsCantCatch';
import { Enterprise } from '@/components/Enterprise';
import { CTASection } from '@/components/CTASection';

export default function HomePage() {
  return (
    <>
      <Hero />
      <WhyNow />
      <OurApproach />
      <Integrations />
      <WhyTestsCantCatch />
      <Enterprise />
      <CTASection />
    </>
  );
}
