import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Reveal } from '@/components/Reveal';
import { posts } from '@/blog/posts';

export default function BlogIndexPage() {
  useEffect(() => {
    const prev = document.title;
    document.title = 'Blog · TrueCourse';
    return () => {
      document.title = prev;
    };
  }, []);

  return (
    <div className="blog-index wrap">
      <Reveal as="p" className="eyebrow">
        Blog
      </Reveal>
      <Reveal as="h1" className="section-title">
        Notes on specs, drift, and <span className="hl">verification.</span>
      </Reveal>

      <div className="bi-list">
        {posts.map((post) => (
          <Link key={post.slug} className="bi-row" to={`/blog/${post.slug}`}>
            <span className="bi-date">{post.date}</span>
            <span className="bi-main">
              <span className="bi-title">{post.title}</span>
              <span className="bi-sub">{post.summary}</span>
            </span>
            <span className="bi-tag">{post.tag}</span>
            <span className="bi-arr">→</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
