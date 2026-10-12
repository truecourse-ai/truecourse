import { useState } from 'react';
import { Reveal } from '@/components/Reveal';
import { trackEvent } from '@/lib/posthog';

/**
 * A human fractional CTO beside the AI CTO, on what it costs, when it is
 * there and when it can start. The AI CTO's price depends on how much CTO the
 * visitor needs, picked from a dropdown in its price cell; each pick is recorded as
 * `cto_tier_picked`, a second answer to what they need.
 */

const TIERS: { id: string; label: string; price: string; covers: string }[] = [
  {
    id: 'keep-working',
    label: 'Keep my app working',
    price: '$99 a month',
    covers: 'Tests every change, watches the app and fixes what breaks.',
  },
  {
    id: 'build',
    label: "Also build what's next",
    price: '$499 a month',
    covers: 'All of that, plus new features, from your words to live.',
  },
  {
    id: 'full-cto',
    label: 'A full CTO',
    price: '$1,500 a month',
    covers: 'All of that, plus tech decisions and managing developers.',
  },
];

const ROWS: { label: string; human: string; ai: string }[] = [
  { label: 'Available', human: 'A few hours a week', ai: 'Day and night' },
  { label: 'Starts', human: 'After weeks of interviews', ai: 'Today' },
];

export function Compare() {
  const [tierId, setTierId] = useState(TIERS[0]!.id);
  const tier = TIERS.find((t) => t.id === tierId) ?? TIERS[0]!;

  const pick = (id: string) => {
    setTierId(id);
    trackEvent('cto_tier_picked', { tier: id });
  };

  // The dropdown sits in the AI CTO's price cell, or above the table on a phone, where the cell is too narrow.
  const tierSelect = (
    <select className="bs-tier" aria-label="How much CTO you need" value={tier.id} onChange={(e) => pick(e.target.value)}>
      {TIERS.map((t) => (
        <option key={t.id} value={t.id}>
          {t.label}
        </option>
      ))}
    </select>
  );

  return (
    <section className="band" id="compare">
      <div className="wrap">
        <Reveal className="bs-center">
          <h2 className="section-h">A fractional CTO, without the hiring</h2>
        </Reveal>
        <Reveal className="bs-compare">
          <label className="bs-tier-pick">
            <span>How much CTO do you need?</span>
            {tierSelect}
          </label>
          <table>
            <thead>
              <tr>
                <th />
                <th scope="col">Human fractional CTO</th>
                <th scope="col" className="ai">
                  AI CTO
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Price</th>
                <td>$5,000 to $15,000 a month</td>
                <td className="ai">
                  <span className="bs-tier-in-cell">{tierSelect}</span>
                  <span className="bs-tier-price">{tier.price}</span>
                  <span className="bs-tier-covers">{tier.covers}</span>
                </td>
              </tr>
              {ROWS.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  <td>{r.human}</td>
                  <td className="ai">{r.ai}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Reveal>
      </div>
    </section>
  );
}
