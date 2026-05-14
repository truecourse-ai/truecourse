import { Routes, Route } from "react-router-dom";
function PageA_23663ff7() {
  return <div>Page A</div>;
}
function PageB_23663ff7() {
  throw new Error("oops");
}
export function AppRouter_23663ff7() {
  return (
    <Routes>
      <Route path="/a-23663ff7" element={<PageA_23663ff7 />} />
      <Route path="/b-23663ff7" element={<PageB_23663ff7 />} />
    </Routes>
  );
}
