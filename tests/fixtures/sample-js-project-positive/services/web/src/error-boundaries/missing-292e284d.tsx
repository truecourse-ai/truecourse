import { Routes, Route } from "react-router-dom";
function PageA_292e284d() {
  return <div>Page A</div>;
}
function PageB_292e284d() {
  throw new Error("oops");
}
export function AppRouter_292e284d() {
  return (
    <Routes>
      <Route path="/a-292e284d" element={<PageA_292e284d />} />
      <Route path="/b-292e284d" element={<PageB_292e284d />} />
    </Routes>
  );
}
