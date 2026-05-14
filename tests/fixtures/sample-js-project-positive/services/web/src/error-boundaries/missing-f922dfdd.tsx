import { Routes, Route } from "react-router-dom";
function PageA_f922dfdd() {
  return <div>Page A</div>;
}
function PageB_f922dfdd() {
  throw new Error("oops");
}
export function AppRouter_f922dfdd() {
  return (
    <Routes>
      <Route path="/a-f922dfdd" element={<PageA_f922dfdd />} />
      <Route path="/b-f922dfdd" element={<PageB_f922dfdd />} />
    </Routes>
  );
}
