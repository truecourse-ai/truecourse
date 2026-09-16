import { Link } from 'react-router';
import { posts } from '@/blog';

/**
 * Home-page blog snippet. The "Blog" nav item scrolls to this `#blog` section,
 * which surfaces the latest post and links out to the full index.
 */
export function BlogTeaser() {
  const post = posts[0];

  return (
    <section className="band" id="blog">
      <div className="wrap">
        <h2 className="eyebrow">Blog</h2>

        <Link to={`/blog/${post.slug}`} className="post-card featured" style={{ marginTop: 28 }}>
          <div className="pcf-main">
            <div className="pc-tag">{post.tag} · Latest post</div>
            <h3>{post.title}</h3>
            <p>{post.summary}</p>
            <div className="pc-meta">
              <span className="pc-ava author" aria-hidden="true">
                MG
              </span>
              {post.author} · {post.date} · {post.readMinutes} min
              <span className="pc-read">Read the post →</span>
            </div>
          </div>
          <div className="pcf-side" aria-hidden="true">
            <img className="pcf-chart" src={post.teaserImage} alt="" />
          </div>
        </Link>

        <p className="fine">
          <Link to="/blog">View all posts →</Link>
        </p>
      </div>
    </section>
  );
}
