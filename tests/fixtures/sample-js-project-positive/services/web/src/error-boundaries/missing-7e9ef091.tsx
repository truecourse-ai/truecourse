import { Routes, Route } from "react-router-dom";
function PageA_7e9ef091() {
  return <div>Page A</div>;
}
function PageB_7e9ef091() {
  throw new Error("oops");
}
export function AppRouter_7e9ef091() {
  return (
    <Routes>
      <Route path="/a-7e9ef091" element={<PageA_7e9ef091 />} />
      <Route path="/b-7e9ef091" element={<PageB_7e9ef091 />} />
    </Routes>
  );
}
