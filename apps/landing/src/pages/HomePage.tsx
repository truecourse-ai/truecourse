import { Hero } from '@/components/Hero';
import { WhyNow } from '@/components/WhyNow';
import { HowItWorks } from '@/components/HowItWorks';
import { WhereKnowledgeLives } from '@/components/WhereKnowledgeLives';
import { BeforeAfter } from '@/components/BeforeAfter';
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
      <Enterprise />
      <CTASection />
    </>
  );
}
