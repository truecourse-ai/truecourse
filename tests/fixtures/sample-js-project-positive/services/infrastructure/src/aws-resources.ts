declare const Port: { tcp: (port: number) => unknown };
export function restrictedSshAccess(): unknown {
  const SSH_PORT = 22;
  return Port.tcp(SSH_PORT);
}
