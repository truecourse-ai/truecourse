import { useEffect } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { FaLinkedin } from 'react-icons/fa6';
import { getPost } from '@/blog/posts';

export default function BlogPostPage() {
  const { slug } = useParams();
  const post = getPost(slug);

  useEffect(() => {
    if (!post) return;
    const prev = document.title;
    document.title = `${post.title} · TrueCourse Blog`;
    return () => {
      document.title = prev;
    };
  }, [post]);

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
