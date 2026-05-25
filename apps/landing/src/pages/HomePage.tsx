import { Hero } from '@/components/Hero';
import { WhyNow } from '@/components/WhyNow';
import { WhyTestsCantCatch } from '@/components/WhyTestsCantCatch';
import { Enterprise } from '@/components/Enterprise';
import { CTASection } from '@/components/CTASection';

export default function HomePage() {
  return (
    <>
      <Hero />
      <WhyNow />
      <WhyTestsCantCatch />
      <Enterprise />
      <CTASection />
    </>
  );
}
