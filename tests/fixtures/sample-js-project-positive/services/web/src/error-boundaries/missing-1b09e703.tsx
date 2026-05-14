import { Routes, Route } from "react-router-dom";
function PageA_1b09e703() {
  return <div>Page A</div>;
}
function PageB_1b09e703() {
  throw new Error("oops");
}
export function AppRouter_1b09e703() {
  return (
    <Routes>
      <Route path="/a-1b09e703" element={<PageA_1b09e703 />} />
      <Route path="/b-1b09e703" element={<PageB_1b09e703 />} />
    </Routes>
  );
}
