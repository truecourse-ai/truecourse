import { Link } from 'react-router';
import { Reveal } from '@/components/Reveal';
import { pageMeta } from '@/lib/seo';
import { posts } from '@/blog';

export const meta = () =>
  pageMeta({
    title: 'Blog · TrueCourse',
    description: 'Notes on specs, drift, and verification — from the team building TrueCourse.',
    path: '/blog',
  });

export default function BlogIndexPage() {
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
