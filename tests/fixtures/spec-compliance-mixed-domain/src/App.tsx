import { Route, Routes } from 'react-router-dom'

function Profile() {
  return (
    <main>
      <h1>Welcome back</h1>
      <form>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required />
        <button type="submit">Save profile</button>
      </form>
    </main>
  )
}

export function App() {
  return (
    <Routes>
      <Route path="/profile" element={<Profile />} />
    </Routes>
  )
}
