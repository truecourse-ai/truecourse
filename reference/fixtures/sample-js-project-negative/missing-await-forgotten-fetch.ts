/**
 * Negative fixture for bugs/deterministic/missing-await.
 *
 * The async call result is stored and then used as if it were the resolved
 * value (`user.name`), but the `await` was forgotten — `user` holds a pending
 * Promise, so `user.name` is `undefined`. This is the real bug the rule
 * catches. The variable is NOT named with a `...Promise` suffix, so nothing
 * signals that holding a promise here is intentional.
 */

interface UserRecord {
  name: string
}

function fetchUser(userId: string): Promise<UserRecord> {
  return Promise.resolve({ name: userId })
}

export async function loadUserName(userId: string): Promise<string> {
  // VIOLATION: bugs/deterministic/missing-await
  const user = fetchUser(userId)
  return user.name
}
