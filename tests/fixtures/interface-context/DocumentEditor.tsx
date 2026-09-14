import { useState } from 'react'
import { EditorDialog } from './EditorDialog'

export function DocumentEditor({ record, save, remove, back }) {
  const [draft, setDraft] = useState(record.title)
  const [showDelete, setShowDelete] = useState(false)
  const [error, setError] = useState('')

  async function saveDraft() {
    if (!draft.trim()) {
      setError('Title is required')
      return
    }
    try {
      await save({ ...record, title: draft })
      back()
    } catch {
      setError('Save failed')
    }
  }

  async function confirmDelete() {
    try {
      await remove(record.id)
      back()
    } catch {
      setError('Deletion failed')
    }
  }

  return <section>
    <input aria-label="Title" value={draft} onChange={event => setDraft(event.target.value)} />
    <button onClick={saveDraft}>Save</button>
    <button onClick={() => { setDraft(record.title); back() }}>Cancel edits</button>
    <button onClick={() => setShowDelete(true)}>Delete</button>
    {error && <p role="alert">{error}</p>}
    {showDelete && <EditorDialog onConfirm={confirmDelete} onCancel={() => setShowDelete(false)} />}
  </section>
}
