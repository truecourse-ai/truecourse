import type { Config } from '@react-router/dev/config';
import { postSlugs } from './src/blog/registry';

export default {
  appDirectory: 'src',
  // Static marketing site: no runtime server. Routes are pre-rendered to static
  // HTML at build time and hydrated in the browser (SPA).
  ssr: false,
  async prerender({ getStaticPaths }) {
    // All static routes (/, /request-access, /blog) plus one path per blog post.
    return [...getStaticPaths(), ...postSlugs.map((slug) => `/blog/${slug}`)];
  },
} satisfies Config;
