
declare function redirect2(url: string): Response;
declare namespace RouteD { interface LoaderArgs { params: { teamUrl: string }; request: Request } }

export async function loader({ params }: RouteD.LoaderArgs) {
  return redirect2(`/t/${params.teamUrl}/documents`);
}
