import { Routes, Route } from "react-router-dom";
function PageA_f514fb0a() {
  return <div>Page A</div>;
}
function PageB_f514fb0a() {
  throw new Error("oops");
}
export function AppRouter_f514fb0a() {
  return (
    <Routes>
      <Route path="/a-f514fb0a" element={<PageA_f514fb0a />} />
      <Route path="/b-f514fb0a" element={<PageB_f514fb0a />} />
    </Routes>
  );
}
