// Spec mandates migrating off the deprecated RestSharp package to
// IHttpClientFactory/HttpClient. It is still declared in SampleApi.csproj and
// used here.
// IL-DRIFT: ForbiddenArtifact:deprecated-http-client / forbidden.dependency.RestSharp.present
using RestSharp;

namespace SampleApi.Services;

public class HttpClientService
{
    public string FetchLegacy(string url)
    {
        var client = new RestClient(url);
        var response = client.Execute(new RestRequest());
        return response.Content ?? string.Empty;
    }
}
