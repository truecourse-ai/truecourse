import { Routes, Route } from "react-router-dom";
function PageA_7e179d77() {
  return <div>Page A</div>;
}
function PageB_7e179d77() {
  throw new Error("oops");
}
export function AppRouter_7e179d77() {
  return (
    <Routes>
      <Route path="/a-7e179d77" element={<PageA_7e179d77 />} />
      <Route path="/b-7e179d77" element={<PageB_7e179d77 />} />
    </Routes>
  );
}
