import { Routes, Route } from "react-router-dom";
function PageA_583de220() {
  return <div>Page A</div>;
}
function PageB_583de220() {
  throw new Error("oops");
}
export function AppRouter_583de220() {
  return (
    <Routes>
      <Route path="/a-583de220" element={<PageA_583de220 />} />
      <Route path="/b-583de220" element={<PageB_583de220 />} />
    </Routes>
  );
}
