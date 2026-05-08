/**
 * Framework-convention functions don't need explicit return
 * types: their return-type contract is fixed by the framework
 * (Next.js Page/Layout/route handlers, Remix loaders, React
 * components by PascalCase + JSX return).
 *
 * Positive fixture: NO missing-return-type violations should
 * fire on this file.
 */

import type { ReactNode } from "react";

// React component — PascalCase + JSX return.
export default function HomePage() {
  return <div>Home</div>;
}

// React component with props.
export function SectionSwitcher({ activeSection }: { activeSection: string | null }) {
  return <div>{activeSection ?? "none"}</div>;
}

// Layout component — children prop.
export function Layout({ children }: { children: ReactNode }) {
  return <main>{children}</main>;
}

// Next.js route handler.
export async function GET() {
  const body = await Promise.resolve("ok");
  return new Response(body);
}

// Next.js generator API.
export function generateStaticParams() {
  return [{ slug: "a" }, { slug: "b" }];
}

// Remix loader convention.
export async function loader() {
  await Promise.resolve();
  return { count: 1 };
}

// Remix action convention.
export async function action() {
  await Promise.resolve();
  return { ok: true };
}
