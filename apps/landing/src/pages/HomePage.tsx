import { Hero } from '@/components/Hero';
import { WhyNow } from '@/components/WhyNow';
import { HowItWorks } from '@/components/HowItWorks';
import { WhereKnowledgeLives } from '@/components/WhereKnowledgeLives';
import { BeforeAfter } from '@/components/BeforeAfter';
import { WhereWeFit } from '@/components/WhereWeFit';
import { WhyTestsCantCatch } from '@/components/WhyTestsCantCatch';
import { Enterprise } from '@/components/Enterprise';
import { CTASection } from '@/components/CTASection';

export default function HomePage() {
  return (
    <>
      <Hero />
      <WhyNow />
      <HowItWorks />
      <WhereKnowledgeLives />
      <BeforeAfter />
      <WhereWeFit />
      <WhyTestsCantCatch />
      <Enterprise />
      <CTASection />
    </>
  );
}
