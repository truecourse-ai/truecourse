import { Routes, Route } from "react-router-dom";
function PageA_23cc199f() {
  return <div>Page A</div>;
}
function PageB_23cc199f() {
  throw new Error("oops");
}
export function AppRouter_23cc199f() {
  return (
    <Routes>
      <Route path="/a-23cc199f" element={<PageA_23cc199f />} />
      <Route path="/b-23cc199f" element={<PageB_23cc199f />} />
    </Routes>
  );
}
