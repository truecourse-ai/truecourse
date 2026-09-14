export function EditorDialog({ onConfirm, onCancel, busy = false }) {
  return <div role="dialog" aria-label="Permanently delete document" onKeyDown={event => {
    if (event.key === 'Escape' && !busy) onCancel()
  }}>
    <p>This operation cannot be undone.</p>
    <button disabled={busy} onClick={onConfirm}>Confirm deletion</button>
    <button disabled={busy} onClick={onCancel}>Keep document</button>
  </div>
}
