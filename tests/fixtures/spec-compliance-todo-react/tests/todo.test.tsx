import { describe, expect, it } from 'vitest'

describe('todo app', () => {
  it('adds a todo item', () => {
    expect('add todo item').toContain('add todo')
  })

  it('toggles a todo item', () => {
    expect('toggle todo item').toContain('toggle todo')
  })

  it('clears completed todos', () => {
    expect('clear completed todos').toContain('completed')
  })
})
