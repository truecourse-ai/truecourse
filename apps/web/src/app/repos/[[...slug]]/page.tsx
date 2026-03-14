import RepoGraphPage from '@/components/pages/RepoGraphPage';

export function generateStaticParams() {
  return [{ slug: [] }];
}

export default function Page() {
  return <RepoGraphPage />;
}
