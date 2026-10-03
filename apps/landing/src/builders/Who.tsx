import type { ReactNode } from 'react';
import {
  BookOpen,
  Briefcase,
  Building2,
  Calculator,
  GraduationCap,
  House,
  Megaphone,
  PiggyBank,
  Ruler,
  Scale,
  ShieldCheck,
  Stethoscope,
  TrendingUp,
  Users,
} from 'lucide-react';

type Use = 'Internal tool' | 'For clients' | 'SaaS';

interface Pro {
  icon: ReactNode;
  who: string;
  app: string;
  use: Use;
}

const TOP: Pro[] = [
  { icon: <Calculator />, who: 'CPA', app: 'Client tax portal', use: 'For clients' },
  { icon: <TrendingUp />, who: 'Fractional CFO', app: 'Cash flow dashboard', use: 'For clients' },
  { icon: <Scale />, who: 'Lawyer', app: 'Client intake and cases', use: 'For clients' },
  { icon: <Briefcase />, who: 'Consultant', app: 'Client reporting app', use: 'For clients' },
  { icon: <PiggyBank />, who: 'Financial advisor', app: 'Portfolio review tool', use: 'For clients' },
  { icon: <BookOpen />, who: 'Bookkeeper', app: 'Monthly close checklist', use: 'Internal tool' },
  { icon: <ShieldCheck />, who: 'Insurance broker', app: 'Policy renewal tracker', use: 'Internal tool' },
];

const BOTTOM: Pro[] = [
  { icon: <House />, who: 'Real estate broker', app: 'Offers and listings', use: 'Internal tool' },
  { icon: <Users />, who: 'Recruiter', app: 'Candidate pipeline', use: 'SaaS' },
  { icon: <Stethoscope />, who: 'Clinic owner', app: 'Patient booking', use: 'For clients' },
  { icon: <Building2 />, who: 'Property manager', app: 'Tenant requests', use: 'Internal tool' },
  { icon: <Megaphone />, who: 'Agency owner', app: 'Campaign results portal', use: 'For clients' },
  { icon: <Ruler />, who: 'Architect', app: 'Project approvals', use: 'Internal tool' },
  { icon: <GraduationCap />, who: 'Tutor', app: 'Student progress app', use: 'SaaS' },
];

function Track({ pros, reverse }: { pros: Pro[]; reverse?: boolean }) {
  // Drawn twice, so the track can slide by half its width and start over unseen.
  return (
    <div className="bs-marquee">
      <div className={`bs-track${reverse ? ' reverse' : ''}`}>
        {[...pros, ...pros].map((p, i) => (
          <div className="bs-pro" key={`${p.who}-${i}`} aria-hidden={i >= pros.length}>
            <span className="bs-pro-icon">{p.icon}</span>
            <span className="bs-pro-text">
              <span className="bs-pro-use">{p.use}</span>
              <b>{p.who}</b>
              <span>{p.app}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The people this is for, two rows of them sliding past in opposite
 * directions: professionals in their own field and the app each built with AI,
 * for the firm, for clients or to sell.
 */
export function Who() {
  return (
    <div className="bs-who">
      <Track pros={TOP} />
      <Track pros={BOTTOM} reverse />
    </div>
  );
}
