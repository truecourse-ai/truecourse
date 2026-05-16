import { Routes, Route } from "react-router-dom";
function PageA_fbe23406() {
  return <div>Page A</div>;
}
function PageB_fbe23406() {
  throw new Error("oops");
}
export function AppRouter_fbe23406() {
  return (
    <Routes>
      <Route path="/a-fbe23406" element={<PageA_fbe23406 />} />
      <Route path="/b-fbe23406" element={<PageB_fbe23406 />} />
    </Routes>
  );
}
