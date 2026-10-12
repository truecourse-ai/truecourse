import { type RouteConfig, index, layout, route } from '@react-router/dev/routes';

export default [
  // Shared chrome (header/footer) wraps every page via <Outlet />.
  layout('components/Layout.tsx', [
    index('pages/HomePage.tsx'),
    route('blog', 'pages/BlogIndexPage.tsx'),
    route('blog/:slug', 'pages/BlogPostPage.tsx'),
    // Unknown paths fall back to the home page (same module, distinct route id).
    route('*', 'pages/HomePage.tsx', { id: 'catch-all-home' }),
  ]),
  // The AI CTO page brings its own header and footer. Each ad group has its own
  // path to it, which picks the hero's headline.
  route('builders', 'pages/BuildersPage.tsx'),
  route('part-time-cto', 'pages/BuildersPage.tsx', { id: 'builders-part-time-cto' }),
  // The fractional CTO ad's page, which asks what the visitor needs from a CTO.
  route('fractional-cto', 'pages/FractionalCtoPage.tsx'),
] satisfies RouteConfig;
