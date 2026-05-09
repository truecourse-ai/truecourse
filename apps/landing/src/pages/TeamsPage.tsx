import { useEffect } from 'react';
import { TeamsHero } from '@/components/TeamsHero';
import { TeamInsights } from '@/components/TeamInsights';
import { Comparison } from '@/components/Comparison';
import { Commercial } from '@/components/Commercial';

export default function TeamsPage() {
  useEffect(() => {
    const prev = document.title;
    document.title = 'TrueCourse for teams · join the waitlist';
    return () => {
      document.title = prev;
    };
  }, []);

  return (
    <>
      <TeamsHero />
      <TeamInsights />
      <Comparison />
      <Commercial />
    </>
  );
}
