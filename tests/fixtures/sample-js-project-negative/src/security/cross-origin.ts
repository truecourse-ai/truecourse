/**
 * Security violations related to cross-origin messages and intrusive permissions.
 */

// VIOLATION: security/deterministic/unverified-cross-origin-message
export function unverifiedCrossOriginMessage() {
  window.addEventListener('message', (event) => {
    const data = event.data;
    document.getElementById('output')!.textContent = data;
  });
}

// VIOLATION: security/deterministic/intrusive-permissions
export function intrusivePermissionsMedia() {
  navigator.mediaDevices.getUserMedia({ video: true, audio: true });
}

// VIOLATION: security/deterministic/intrusive-permissions
export function intrusivePermissionsGeo() {
  navigator.geolocation.getCurrentPosition((pos) => {
    console.log(pos.coords);
  });
}

// VIOLATION: security/deterministic/intrusive-permissions
export function intrusivePermissionsQuery() {
  navigator.permissions.query({ name: 'camera' });
}
