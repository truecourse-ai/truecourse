import { Routes, Route } from "react-router-dom";
function PageA_6628a7a5() {
  return <div>Page A</div>;
}
function PageB_6628a7a5() {
  throw new Error("oops");
}
export function AppRouter_6628a7a5() {
  return (
    <Routes>
      <Route path="/a-6628a7a5" element={<PageA_6628a7a5 />} />
      <Route path="/b-6628a7a5" element={<PageB_6628a7a5 />} />
    </Routes>
  );
}
