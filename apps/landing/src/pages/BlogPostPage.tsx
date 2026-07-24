import { Link, Navigate, useParams } from 'react-router';
import { FaLinkedin } from 'react-icons/fa6';
import { pageMeta } from '@/lib/seo';
import { getPost } from '@/blog';

export function meta({ params }: { params: { slug?: string } }) {
  const post = getPost(params.slug);
  if (!post) {
    return pageMeta({
      title: 'Blog · TrueCourse',
      description: 'Notes on specs, drift, and verification — from the team building TrueCourse.',
      path: '/blog',
    });
  }
  return pageMeta({
    title: `${post.title} · TrueCourse Blog`,
    description: post.summary,
    path: `/blog/${post.slug}`,
    type: 'article',
  });
}

export default function BlogPostPage() {
  const { slug } = useParams();
  const post = getPost(slug);

  if (!post) return <Navigate to="/blog" replace />;

  const { Body } = post;

  return (
    <article className="post-wrap">
      <Link className="post-back" to="/blog">
        ← All posts
      </Link>
      <p className="eyebrow" style={{ marginTop: 34 }}>
        {post.tag}
      </p>
      <h1>{post.title}</h1>
      <div className="post-byline">
        <span className="pc-ava author" aria-hidden="true">
          MG
        </span>
        <span className="byline-text">
          {post.author}
          {post.authorUrl ? (
            <a
              className="byline-li"
              href={post.authorUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`${post.author} on LinkedIn`}
            >
              <FaLinkedin />
            </a>
          ) : null}
          {` · ${post.date} · ${post.readMinutes} min read`}
        </span>
      </div>

      <div className="post-body">
        <Body />
      </div>

      <div className="post-foot">
        <Link className="post-back" to="/blog">
          ← All posts
        </Link>
        <Link className="btn btn-primary btn-sm" to="/request-access">
          Request access →
        </Link>
      </div>
    </article>
  );
}
