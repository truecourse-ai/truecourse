
declare interface ClientResponse<T> { ok: boolean; json(): Promise<T> }
declare const AppError: { parseError(e: unknown): Error }

export class ApiClient {
  private async handleError<T>(response: ClientResponse<T>): Promise<void> {
    if (!response.ok) {
      const error = await response.json();
      throw AppError.parseError(error);
    }
  }
}
