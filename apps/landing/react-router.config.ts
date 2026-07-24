import type { Config } from '@react-router/dev/config';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Enumerate blog post slugs from the filenames under src/blog/posts/. Reading the
// directory (rather than importing the modules) keeps this config free of the
// posts' JSX/React graph.
const postsDir = fileURLToPath(new URL('./src/blog/posts', import.meta.url));
const postSlugs = readdirSync(postsDir)
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => f.replace(/\.tsx$/, ''));

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
