import { Routes, Route } from "react-router-dom";
function PageA_ae767403() {
  return <div>Page A</div>;
}
function PageB_ae767403() {
  throw new Error("oops");
}
export function AppRouter_ae767403() {
  return (
    <Routes>
      <Route path="/a-ae767403" element={<PageA_ae767403 />} />
      <Route path="/b-ae767403" element={<PageB_ae767403 />} />
    </Routes>
  );
}
