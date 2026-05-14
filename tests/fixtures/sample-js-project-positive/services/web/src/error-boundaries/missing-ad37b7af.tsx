import { Routes, Route } from "react-router-dom";
function PageA_ad37b7af() {
  return <div>Page A</div>;
}
function PageB_ad37b7af() {
  throw new Error("oops");
}
export function AppRouter_ad37b7af() {
  return (
    <Routes>
      <Route path="/a-ad37b7af" element={<PageA_ad37b7af />} />
      <Route path="/b-ad37b7af" element={<PageB_ad37b7af />} />
    </Routes>
  );
}
