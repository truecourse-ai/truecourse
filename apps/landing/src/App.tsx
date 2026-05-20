import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import HomePage from '@/pages/HomePage';
import TeamsPage from '@/pages/TeamsPage';
import KnowledgePage from '@/pages/KnowledgePage';
import RequestAccessPage from '@/pages/RequestAccessPage';

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/knowledge" element={<KnowledgePage />} />
          <Route path="/request-access" element={<RequestAccessPage />} />
          <Route path="*" element={<HomePage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
