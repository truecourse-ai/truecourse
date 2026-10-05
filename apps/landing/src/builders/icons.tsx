/** The small glyphs the /builders scenes are drawn with, sized by their box. */

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export function Check() {
  return (
    <svg viewBox="0 0 24 24">
      <path {...S} strokeWidth={2.6} d="M5.5 12.5l4.2 4.2 8.8-9.2" />
    </svg>
  );
}

export function Cross() {
  return (
    <svg viewBox="0 0 24 24">
      <path {...S} strokeWidth={2.6} d="M7 7l10 10M17 7L7 17" />
    </svg>
  );
}

/** A ring with a quarter of it lit, turned by `angle` degrees. */
export function Spin({ angle }: { angle: number }) {
  return (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={2.6} />
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeDasharray="14 60"
        transform={`rotate(${angle} 12 12)`}
      />
    </svg>
  );
}

export function Mail() {
  return (
    <svg viewBox="0 0 24 24">
      <rect {...S} x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path {...S} d="M4.5 7l7.5 6 7.5-6" />
    </svg>
  );
}

export function Tap() {
  return (
    <svg viewBox="0 0 24 24">
      <path {...S} d="M9 11V5.5a1.5 1.5 0 013 0V11m0-1.5a1.5 1.5 0 013 0V11m0-.5a1.5 1.5 0 013 0V15c0 3.3-2.2 6-5.5 6-2.4 0-3.8-1.1-5.2-3.2L5 15.2a1.5 1.5 0 012.4-1.7L9 15" />
    </svg>
  );
}

export function Bug() {
  return (
    <svg viewBox="0 0 24 24">
      <rect {...S} x="7.5" y="7.5" width="9" height="12" rx="4.5" />
      <path {...S} d="M9.5 7.5a2.5 2.5 0 015 0M4 13h3.5M16.5 13H20M5 8.5l2.8 1.6M19 8.5l-2.8 1.6M5 18l2.8-1.6M19 18l-2.8-1.6" />
    </svg>
  );
}

export function Chat() {
  return (
    <svg viewBox="0 0 24 24">
      <path {...S} d="M5 5.5h14a1.5 1.5 0 011.5 1.5v8a1.5 1.5 0 01-1.5 1.5H10l-4.5 3.5v-3.5H5A1.5 1.5 0 013.5 15V7A1.5 1.5 0 015 5.5z" />
    </svg>
  );
}

export function Exit() {
  return (
    <svg viewBox="0 0 24 24">
      <path {...S} d="M14 4.5H6.5a1.5 1.5 0 00-1.5 1.5v12a1.5 1.5 0 001.5 1.5H14M10.5 12h10M17 8.5l3.5 3.5-3.5 3.5" />
    </svg>
  );
}

export function Moon() {
  return (
    <svg viewBox="0 0 24 24">
      <path {...S} d="M19.5 14.5A8 8 0 019.5 4.5a8 8 0 1010 10z" />
    </svg>
  );
}

/** The TrueCourse mark, the AI CTO's face in the scenes. */
export function Mark() {
  return <img src="/truecourse-mark-twin-light.svg" alt="" />;
}

/** The pointer the AI CTO drives a browser with, labelled. */
export function Pointer({ label = 'AI CTO' }: { label?: string }) {
  return (
    <>
      <svg viewBox="0 0 30 30" className="bs-pointer-arrow">
        <path
          d="M4 2 L4 24 L10 18.5 L14 27 L18 25.2 L14 17 L22 17 Z"
          fill="var(--accent)"
          stroke="#fff"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
      <span className="bs-pointer-label">{label}</span>
    </>
  );
}
