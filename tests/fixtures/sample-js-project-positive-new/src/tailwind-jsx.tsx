'use client';
export function Button(): JSX.Element {
  return <button type="button" className="inline-flex items-center">Click</button>;
}
export function Card(): JSX.Element {
  return <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"><h3 className="text-lg font-semibold">Title</h3></div>;
}
export function CloseIcon(): JSX.Element {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /></svg>;
}
export function Badge(): JSX.Element {
  return <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium">badge</span>;
}
