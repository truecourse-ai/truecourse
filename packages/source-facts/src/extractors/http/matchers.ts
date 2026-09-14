/**
 * Language-specific HTTP call matchers.
 *
 * Each language defines which callee patterns indicate an HTTP client call
 * and how to classify the client type.
 */

import type { SupportedLanguage } from '@truecourse/shared'

export type HttpClientType = 'fetch' | 'axios' | 'http' | 'unknown'

interface HttpMatcher {
  isHttpCall(calleeName: string): boolean
  getClientType(calleeName: string): HttpClientType
}

const jsMatcher: HttpMatcher = {
  isHttpCall(calleeName) {
    const httpMethods = ['.get', '.post', '.put', '.delete', '.patch', '.request']
    return (
      calleeName === 'fetch' ||
      calleeName.includes('axios') ||
      calleeName.includes('http.request') ||
      calleeName.includes('https.request') ||
      httpMethods.some(method => calleeName.endsWith(method) || calleeName.includes(method + '('))
    )
  },
  getClientType(calleeName) {
    if (calleeName === 'fetch') return 'fetch'
    if (calleeName.includes('axios')) return 'axios'
    if (calleeName.includes('http')) return 'http'
    return 'unknown'
  },
}

const pythonMatcher: HttpMatcher = {
  isHttpCall(calleeName) {
    return (
      calleeName.startsWith('requests.') ||
      calleeName.startsWith('httpx.') ||
      calleeName.includes('aiohttp')
    )
  },
  getClientType(calleeName) {
    // Python HTTP clients are method-based like axios (requests.get, httpx.post)
    if (calleeName.startsWith('requests.') || calleeName.startsWith('httpx.')) return 'axios'
    return 'unknown'
  },
}

const csharpMatcher: HttpMatcher = {
  isHttpCall(calleeName) {
    // HttpClient / IHttpClientFactory clients
    const httpClientMethods = [
      'GetAsync', 'PostAsync', 'PutAsync', 'DeleteAsync', 'PatchAsync', 'SendAsync',
      'GetStringAsync', 'GetStreamAsync', 'GetByteArrayAsync',
      'GetFromJsonAsync', 'PostAsJsonAsync', 'PutAsJsonAsync',
    ]
    // RestSharp
    const restSharpMethods = ['ExecuteAsync', 'ExecuteGetAsync', 'ExecutePostAsync', 'ExecutePutAsync', 'ExecuteDeleteAsync']
    return [...httpClientMethods, ...restSharpMethods].some(
      (method) => calleeName === method || calleeName.endsWith('.' + method),
    )
  },
  getClientType(calleeName) {
    // HttpClient is method-based like axios
    if (calleeName.includes('Execute')) return 'http' // RestSharp
    return 'http'
  },
}

const MATCHERS: Partial<Record<SupportedLanguage, HttpMatcher>> = {
  typescript: jsMatcher,
  tsx: jsMatcher,
  javascript: jsMatcher,
  python: pythonMatcher,
  csharp: csharpMatcher,
}

export function getHttpMatcher(language: SupportedLanguage): HttpMatcher | null {
  return MATCHERS[language] || null
}
