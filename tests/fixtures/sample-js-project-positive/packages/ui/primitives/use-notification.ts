
declare type NotificationItem = { id: string; message: string; type: 'info' | 'error' | 'success' };
declare type NotificationState = { items: NotificationItem[] };
declare type NotificationAction =
  | { type: 'ADD'; item: NotificationItem }
  | { type: 'DISMISS'; id: string };

const notificationReducer = (state: NotificationState, action: NotificationAction): NotificationState => {
  switch (action.type) {
    case 'ADD':
      return { items: [action.item, ...state.items] };
    case 'DISMISS':
      return { items: state.items.filter((n) => n.id !== action.id) };
  }
};

const notificationListeners: Array<(_state: NotificationState) => void> = [];

let notificationState: NotificationState = { items: [] };

function dispatchNotification(action: NotificationAction) {
  notificationState = notificationReducer(notificationState, action);
  notificationListeners.forEach((listener) => {
    listener(notificationState);
  });
}


// Enum members with self-referential string values — standard string enum, type-system discriminants
export enum NotificationActionType {
  ADD_NOTIFICATION = 'ADD_NOTIFICATION',
  REMOVE_NOTIFICATION = 'REMOVE_NOTIFICATION',
  UPDATE_NOTIFICATION = 'UPDATE_NOTIFICATION',
  DISMISS_ALL = 'DISMISS_ALL',
}

interface Notification {
  id: string;
  message: string;
  variant: 'info' | 'success' | 'warning' | 'error';
}

type NotificationAction =
  | { type: NotificationActionType.ADD_NOTIFICATION; notification: Notification }
  | { type: NotificationActionType.REMOVE_NOTIFICATION; id: string }
  | { type: NotificationActionType.DISMISS_ALL };



// --- FP shape: custom React hook returning an object spreading state; return type inferred from useState and spread ---
declare function useState2<T>(initial: T): [T, (v: T) => void];

declare interface Toast { id: string; title: string; description?: string }
declare interface ToastState { toasts: Toast[] }

declare const memoryState: ToastState;
declare const listeners: Array<(s: ToastState) => void>;

function useToast2() {
  const [state, setState] = useState2<ToastState>(memoryState);

  // Register listener on mount
  listeners.push(setState);

  return {
    ...state,
    dismiss(toastId?: string) {
      // dismiss implementation
    },
  };
}
