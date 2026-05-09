import { Hero } from '@/components/Hero';
import { Capabilities } from '@/components/Capabilities';
import { OpenSource } from '@/components/OpenSource';
// Reports section is hidden until we have real OSS analysis results to publish.
// Sample data still lives in `src/data/analyses.ts`; uncomment the import + the
// <AnalysisReports /> block below to bring it back. When you re-enable, also
// restore the "Reports" nav entry in Header.tsx and the "Field reports" link in
// Footer.tsx (both currently commented next to this same flag).
// import { AnalysisReports } from '@/components/AnalysisReports';

export default function HomePage() {
  return (
    <>
      <Hero />
      <Capabilities />
      <OpenSource />
      {/* <AnalysisReports /> */}
    </>
  );
}
