import { Routes, Route } from "react-router-dom";
function PageA_7e0fb6f3() {
  return <div>Page A</div>;
}
function PageB_7e0fb6f3() {
  throw new Error("oops");
}
export function AppRouter_7e0fb6f3() {
  return (
    <Routes>
      <Route path="/a-7e0fb6f3" element={<PageA_7e0fb6f3 />} />
      <Route path="/b-7e0fb6f3" element={<PageB_7e0fb6f3 />} />
    </Routes>
  );
}
