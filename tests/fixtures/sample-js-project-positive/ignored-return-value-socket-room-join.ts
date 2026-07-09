/**
 * Positive fixture for bugs/deterministic/ignored-return-value.
 *
 * A realtime connection's `.join(room)` is a side-effecting subscribe command
 * that returns void — it is not `Array.prototype.join`, whose joined-string
 * result must be consumed. The rule must not flag a bare `socket.join(...)`
 * statement just because the method name collides with the array method.
 */

interface RoomConnection {
  join(room: string): void;
}

export function subscribeToRoom(socket: RoomConnection, room: string): void {
  socket.join(room);
}
