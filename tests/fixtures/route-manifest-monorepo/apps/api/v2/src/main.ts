// Fixture Nest bootstrap — the `/v2` every route of this app is mounted under.
export async function bootstrap(app: { setGlobalPrefix: (p: string) => void; listen: (p: number) => void }): Promise<void> {
  app.setGlobalPrefix('v2')
  app.listen(Number(process.env.PORT))
}
