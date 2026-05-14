// Input placeholder showing example OIDC well-known URL — display-only UI hint, not used at runtime.
function OidcConfigForm() {
  return (
    <form>
      <label htmlFor="wellKnown">Well-Known URL</label>
      <input
        id="wellKnown"
        type="url"
        placeholder="https://login.example.com/realms/main/.well-known/openid-configuration"
      />
    </form>
  );
}
