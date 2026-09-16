import { pageMeta } from '@/lib/seo';
import { Hero } from '@/components/Hero';
import { HowItWorks } from '@/components/HowItWorks';
import { Sandbox } from '@/components/Sandbox';
import { Integrations } from '@/components/Integrations';
import { Enterprise } from '@/components/Enterprise';
import { BlogTeaser } from '@/components/BlogTeaser';
import { CTASection } from '@/components/CTASection';

export const meta = () =>
  pageMeta({
    title: 'TrueCourse · Know which of your requirements hold',
    description:
      'TrueCourse is the IDE for product owners. It reads the requirements you own, proves each one against the running product, and shows you section by section what holds, what is broken and what is not yet covered, kept current as the product changes.',
    path: '/',
  });

export default function HomePage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <Sandbox />
      <Integrations />
      <Enterprise />
      <BlogTeaser />
      <CTASection />
    </>
  );
}
