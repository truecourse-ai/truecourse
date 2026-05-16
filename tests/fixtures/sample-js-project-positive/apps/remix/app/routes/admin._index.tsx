// remix-route-module: Remix route that only redirects — framework-managed, not a Node.js process entry point
declare function redirect(url: string): never;

export function loader() {
  throw redirect('/admin/overview');
}

export default function AdminIndexPage() {
  // Redirect handled by loader
  return null;
}
