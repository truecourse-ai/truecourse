import { type RouteConfig, index, layout, route } from '@react-router/dev/routes';

export default [
  // Shared chrome (header/footer) wraps every page via <Outlet />.
  layout('components/Layout.tsx', [
    index('pages/HomePage.tsx'),
    route('request-access', 'pages/RequestAccessPage.tsx'),
    route('blog', 'pages/BlogIndexPage.tsx'),
    route('blog/:slug', 'pages/BlogPostPage.tsx'),
    // Unknown paths fall back to the home page (same module, distinct route id).
    route('*', 'pages/HomePage.tsx', { id: 'catch-all-home' }),
  ]),
] satisfies RouteConfig;
