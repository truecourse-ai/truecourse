
declare type ToastAction = { type: 'ADD'; toast: { id: string; message: string } } | { type: 'REMOVE'; id: string };
declare let listeners: Array<(action: ToastAction) => void>;

function dispatch(action: ToastAction) {
  for (const listener of listeners) {
    listener(action);
  }
}

function addToast(message: string) {
  const id = Math.random().toString(36).slice(2);
  dispatch({ type: 'ADD', toast: { id, message } });
  setTimeout(() => dispatch({ type: 'REMOVE', id }), 5000);
}
