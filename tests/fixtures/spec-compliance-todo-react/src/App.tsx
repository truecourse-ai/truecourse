import { FormEvent, useMemo, useState } from 'react'
import { Route, Routes } from 'react-router-dom'

interface Todo {
  id: number
  title: string
  completed: boolean
}

function TodoApp() {
  const [todos, setTodos] = useState<Todo[]>([
    { id: 1, title: 'Write the product spec', completed: true },
    { id: 2, title: 'Run spec compliance analysis', completed: false },
  ])
  const [newTodo, setNewTodo] = useState('')

  const openCount = useMemo(
    () => todos.filter((todo) => !todo.completed).length,
    [todos],
  )

  function addTodo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const title = newTodo.trim()
    if (!title) return

    setTodos((current) => [
      ...current,
      { id: Date.now(), title, completed: false },
    ])
    setNewTodo('')
  }

  function toggleTodo(id: number) {
    setTodos((current) => current.map((todo) => (
      todo.id === id ? { ...todo, completed: !todo.completed } : todo
    )))
  }

  function clearCompleted() {
    setTodos((current) => current.filter((todo) => !todo.completed))
  }

  return (
    <main>
      <h1>Todo List</h1>
      <p>{openCount} open tasks</p>

      <form onSubmit={addTodo}>
        <label htmlFor="todo-title">New todo</label>
        <input
          id="todo-title"
          name="todo"
          type="text"
          required
          value={newTodo}
          onChange={(event) => setNewTodo(event.target.value)}
        />
        <button type="submit">Add todo</button>
      </form>

      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>
            <label>
              <input
                name={`todo-${todo.id}`}
                type="checkbox"
                checked={todo.completed}
                onChange={() => toggleTodo(todo.id)}
              />
              {todo.title}
            </label>
          </li>
        ))}
      </ul>

      <button type="button" onClick={clearCompleted}>Clear completed</button>
    </main>
  )
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<TodoApp />} />
    </Routes>
  )
}
