import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { Reveal } from '@/components/Reveal';
import { useReveal } from '@/lib/useReveal';
import { posts } from '@/blog/posts';

/**
 * Home-page blog snippet. The "Blog" nav item scrolls to this `#blog` section,
 * which surfaces the latest post and links out to the full index.
 */
export function BlogTeaser() {
  const post = posts[0];
  const { ref, visible } = useReveal<HTMLAnchorElement>();

  return (
    <section className="band" id="blog">
      <div className="wrap">
        <Reveal as="p" className="eyebrow">
          Blog
        </Reveal>
        <Reveal as="h2" className="section-title">
          <span className="dim">Notes from the team on</span> specs, drift, and{' '}
          <span className="hl">verification.</span>
        </Reveal>

        <Link
          ref={ref}
          to={`/blog/${post.slug}`}
          className={cn('post-card featured reveal', visible && 'visible')}
          style={{ marginTop: 48 }}
        >
          <div className="pcf-main">
            <div className="pc-tag">{post.tag} · Latest post</div>
            <h3>{post.title}</h3>
            <p>{post.excerpt}</p>
            <div className="pc-meta">
              <span className="pc-ava author" aria-hidden="true">
                MG
              </span>
              {post.author} · {post.date} · {post.readMinutes} min
              <span className="pc-read">Read the post →</span>
            </div>
          </div>
          <div className="pcf-side" aria-hidden="true">
            <img className="pcf-chart" src="/blog/chart_merge_teaser_dark.png" alt="" />
          </div>
        </Link>

        <p className="fine">
          <Link to="/blog" style={{ color: 'var(--accent)' }}>
            View all posts →
          </Link>
        </p>
      </div>
    </section>
  );
}
