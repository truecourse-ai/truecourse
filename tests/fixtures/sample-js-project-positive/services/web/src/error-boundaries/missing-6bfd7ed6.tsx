import { Routes, Route } from "react-router-dom";
function PageA_6bfd7ed6() {
  return <div>Page A</div>;
}
function PageB_6bfd7ed6() {
  throw new Error("oops");
}
export function AppRouter_6bfd7ed6() {
  return (
    <Routes>
      <Route path="/a-6bfd7ed6" element={<PageA_6bfd7ed6 />} />
      <Route path="/b-6bfd7ed6" element={<PageB_6bfd7ed6 />} />
    </Routes>
  );
}
