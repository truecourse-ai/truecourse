import { Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import HomePage from './components/pages/HomePage';
import RepoGraphPage from './components/pages/RepoGraphPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route
          path="/repos/:repoId"
          element={
            <Suspense>
              <RepoGraphPage />
            </Suspense>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
