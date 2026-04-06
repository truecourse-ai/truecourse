/**
 * Secret detection patterns — 222 rules covering all major API key/token formats.
 * Derived from Gitleaks patterns but using our own naming convention.
 *
 * Since we match against extracted string VALUES (not raw source lines),
 * we don't need line-level boundary patterns — just the token format itself.
 */

export interface SecretPattern {
  id: string
  description: string
  regex: RegExp
  keywords?: string[]
  entropy?: number
  secretGroup?: number
  useStopwords?: boolean
  allowlist?: RegExp[]
  requireNearby?: {
    pattern: RegExp
    withinLines?: number  // default 5
  }
}

export const SECRET_PATTERNS: SecretPattern[] = [
  // ─── 1Password ───────────────────────────────────────────────────────
  {
    id: '1password-secret',
    description: '1Password secret key',
    regex: /A3-[A-Z0-9]{6}-[A-Z0-9]{6}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}/i,
    keywords: ['a3-'],
    entropy: 3.8,
  },
  {
    id: '1password-service-token',
    description: '1Password service account token',
    regex: /ops_[A-Za-z0-9_-]{50,}/,
    keywords: ['ops_'],
    entropy: 4,
  },

  // ─── Adafruit ────────────────────────────────────────────────────────
  {
    id: 'adafruit-key',
    description: 'Adafruit API key',
    regex: /(?:adafruit)(?:.{0,40})(aio_[A-Za-z0-9]{28})/i,
    keywords: ['adafruit'],
    secretGroup: 1,
  },

  // ─── Adobe ───────────────────────────────────────────────────────────
  {
    id: 'adobe-client-id',
    description: 'Adobe OAuth Web Client ID',
    regex: /(?:adobe)(?:.{0,40})([0-9a-f]{32})/i,
    keywords: ['adobe'],
    entropy: 2,
    secretGroup: 1,
  },
  {
    id: 'adobe-client-secret',
    description: 'Adobe Client Secret',
    regex: /p8e-[A-Za-z0-9_-]{32}/,
    keywords: ['p8e-'],
    entropy: 2,
  },

  // ─── Age encryption ──────────────────────────────────────────────────
  {
    id: 'age-secret-key',
    description: 'Age encryption secret key',
    regex: /AGE-SECRET-KEY-1[0-9A-Z]{58}/,
    keywords: ['age-secret-key-1'],
  },

  // ─── Airtable ────────────────────────────────────────────────────────
  {
    id: 'airtable-key',
    description: 'Airtable API key',
    regex: /(?:airtable)(?:.{0,40})(key[A-Za-z0-9]{14})/i,
    keywords: ['airtable'],
    secretGroup: 1,
  },
  {
    id: 'airtable-pat',
    description: 'Airtable Personal Access Token',
    regex: /(?:airtable)(?:.{0,40})(pat[A-Za-z0-9.]{40,80})/i,
    keywords: ['airtable'],
    secretGroup: 1,
  },

  // ─── Algolia ─────────────────────────────────────────────────────────
  {
    id: 'algolia-key',
    description: 'Algolia API key',
    regex: /(?:algolia)(?:.{0,40})([a-z0-9]{32})/i,
    keywords: ['algolia'],
    secretGroup: 1,
  },

  // ─── Alibaba ─────────────────────────────────────────────────────────
  {
    id: 'alibaba-access-key',
    description: 'Alibaba Cloud AccessKey ID',
    regex: /LTAI[A-Za-z0-9]{12,20}/,
    keywords: ['ltai'],
    entropy: 2,
  },
  {
    id: 'alibaba-secret',
    description: 'Alibaba Cloud Secret Key',
    regex: /(?:alibaba)(?:.{0,40})([A-Za-z0-9]{30})/i,
    keywords: ['alibaba'],
    entropy: 2,
    secretGroup: 1,
  },

  // ─── Anthropic ───────────────────────────────────────────────────────
  {
    id: 'anthropic-admin-key',
    description: 'Anthropic Admin API Key',
    regex: /sk-ant-admin01-[A-Za-z0-9_-]{80,}/,
    keywords: ['sk-ant-admin01'],
  },
  {
    id: 'anthropic-key',
    description: 'Anthropic API Key',
    regex: /sk-ant-api03-[A-Za-z0-9_-]{80,}/,
    keywords: ['sk-ant-api03'],
  },

  // ─── Artifactory ─────────────────────────────────────────────────────
  {
    id: 'artifactory-key',
    description: 'Artifactory API key',
    regex: /AKCp[A-Za-z0-9]{60,}/,
    keywords: ['akcp'],
    entropy: 4.5,
  },
  {
    id: 'artifactory-ref-token',
    description: 'Artifactory reference token',
    regex: /cmVmd[A-Za-z0-9+/=]{60,}/,
    keywords: ['cmvmd'],
    entropy: 4.5,
  },

  // ─── Asana ───────────────────────────────────────────────────────────
  {
    id: 'asana-client-id',
    description: 'Asana Client ID',
    regex: /(?:asana)(?:.{0,40})(\d{16})/i,
    keywords: ['asana'],
    secretGroup: 1,
  },
  {
    id: 'asana-client-secret',
    description: 'Asana Client Secret',
    regex: /(?:asana)(?:.{0,40})([a-z0-9]{32})/i,
    keywords: ['asana'],
    secretGroup: 1,
  },

  // ─── Atlassian ───────────────────────────────────────────────────────
  {
    id: 'atlassian-token',
    description: 'Atlassian API token',
    regex: /[A-Za-z0-9]{24}\.[A-Za-z0-9_-]{152,256}/,
    entropy: 3.5,
  },

  // ─── Authress ────────────────────────────────────────────────────────
  {
    id: 'authress-key',
    description: 'Authress Service Client Access Key',
    regex: /(?:sc|ext|scauth|authress)_[a-z0-9]{5,30}\.[a-z0-9]{4,6}\.acc[_-][a-z0-9-]{10,32}\.[a-z0-9+/]{30,120}={0,2}/i,
    entropy: 2,
  },

  // ─── AWS ─────────────────────────────────────────────────────────────
  {
    id: 'aws-access-key',
    description: 'AWS Access Key ID',
    regex: /((?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16})/,
    entropy: 3,
    secretGroup: 1,
  },
  {
    id: 'aws-bedrock-key-long',
    description: 'Amazon Bedrock API key (long-lived)',
    regex: /ABSK[A-Za-z0-9+/]{40,}/,
    keywords: ['absk'],
    entropy: 3,
  },
  {
    id: 'aws-bedrock-key-short',
    description: 'Amazon Bedrock API key (short-lived)',
    regex: /bedrock-api-key-[A-Za-z0-9+/]{40,}/,
    keywords: ['bedrock-api-key-'],
    entropy: 3,
  },

  // ─── Azure ───────────────────────────────────────────────────────────
  {
    id: 'azure-ad-secret',
    description: 'Azure AD Client Secret',
    regex: /[a-zA-Z0-9~]{3}Q~[A-Za-z0-9_~.-]{31,34}/,
    keywords: ['q~'],
    entropy: 3,
  },

  // ─── Beamer ──────────────────────────────────────────────────────────
  {
    id: 'beamer-token',
    description: 'Beamer API token',
    regex: /(?:beamer)(?:.{0,40})(b_[A-Za-z0-9=+/]{40,48})/i,
    keywords: ['beamer'],
    secretGroup: 1,
  },

  // ─── Bitbucket ───────────────────────────────────────────────────────
  {
    id: 'bitbucket-client-id',
    description: 'Bitbucket Client ID',
    regex: /(?:bitbucket)(?:.{0,40})([A-Za-z0-9]{32})/i,
    keywords: ['bitbucket'],
    secretGroup: 1,
  },
  {
    id: 'bitbucket-client-secret',
    description: 'Bitbucket Client Secret',
    regex: /(?:bitbucket)(?:.{0,40})([A-Za-z0-9_-]{32,64})/i,
    keywords: ['bitbucket'],
    secretGroup: 1,
  },

  // ─── Bittrex ─────────────────────────────────────────────────────────
  {
    id: 'bittrex-access-key',
    description: 'Bittrex Access Key',
    regex: /(?:bittrex)(?:.{0,40})([a-z0-9]{32})/i,
    keywords: ['bittrex'],
    secretGroup: 1,
  },
  {
    id: 'bittrex-secret',
    description: 'Bittrex Secret Key',
    regex: /(?:bittrex)(?:.{0,40})([a-z0-9]{32})/i,
    keywords: ['bittrex'],
    secretGroup: 1,
  },

  // ─── Cisco Meraki ────────────────────────────────────────────────────
  {
    id: 'cisco-meraki-key',
    description: 'Cisco Meraki API key',
    regex: /(?:meraki)(?:.{0,40})([0-9a-f]{40})/i,
    keywords: ['meraki'],
    entropy: 3,
    secretGroup: 1,
  },

  // ─── ClickHouse ──────────────────────────────────────────────────────
  {
    id: 'clickhouse-secret',
    description: 'ClickHouse Cloud API secret key',
    regex: /4b1d[A-Za-z0-9]{40,}/,
    keywords: ['4b1d'],
    entropy: 3,
  },

  // ─── Clojars ─────────────────────────────────────────────────────────
  {
    id: 'clojars-token',
    description: 'Clojars API token',
    regex: /CLOJARS_[A-Za-z0-9]{60}/i,
    keywords: ['clojars_'],
    entropy: 2,
  },

  // ─── Cloudflare ──────────────────────────────────────────────────────
  {
    id: 'cloudflare-key',
    description: 'Cloudflare API key',
    regex: /(?:cloudflare)(?:.{0,40})([0-9a-f]{37})/i,
    keywords: ['cloudflare'],
    entropy: 2,
    secretGroup: 1,
  },
  {
    id: 'cloudflare-global-key',
    description: 'Cloudflare Global API key',
    regex: /(?:cloudflare)(?:.{0,40})([0-9a-f]{37})/i,
    keywords: ['cloudflare'],
    entropy: 2,
    secretGroup: 1,
  },
  {
    id: 'cloudflare-ca-key',
    description: 'Cloudflare Origin CA key',
    regex: /v1\.0-[0-9a-f]{24}-[0-9a-f]{146}/,
    entropy: 2,
  },

  // ─── Codecov ─────────────────────────────────────────────────────────
  {
    id: 'codecov-token',
    description: 'Codecov Access Token',
    regex: /(?:codecov)(?:.{0,40})([0-9a-f]{32})/i,
    keywords: ['codecov'],
    secretGroup: 1,
  },

  // ─── Cohere ──────────────────────────────────────────────────────────
  {
    id: 'cohere-token',
    description: 'Cohere API token',
    regex: /[a-zA-Z0-9]{40}(?:-(?:us|eu))?/,
    entropy: 4,
    useStopwords: true,
  },

  // ─── Coinbase ────────────────────────────────────────────────────────
  {
    id: 'coinbase-token',
    description: 'Coinbase Access Token',
    regex: /(?:coinbase)(?:.{0,40})([A-Za-z0-9_-]{64})/i,
    keywords: ['coinbase'],
    secretGroup: 1,
  },

  // ─── Confluent ───────────────────────────────────────────────────────
  {
    id: 'confluent-token',
    description: 'Confluent Access Token',
    regex: /(?:confluent)(?:.{0,40})([A-Za-z0-9]{16})/i,
    keywords: ['confluent'],
    secretGroup: 1,
  },
  {
    id: 'confluent-secret',
    description: 'Confluent Secret Key',
    regex: /(?:confluent)(?:.{0,40})([A-Za-z0-9+/]{64})/i,
    keywords: ['confluent'],
    secretGroup: 1,
  },

  // ─── Contentful ──────────────────────────────────────────────────────
  {
    id: 'contentful-token',
    description: 'Contentful delivery API token',
    regex: /(?:contentful)(?:.{0,40})([A-Za-z0-9_-]{43})/i,
    keywords: ['contentful'],
    secretGroup: 1,
  },

  // ─── curl ────────────────────────────────────────────────────────────
  {
    id: 'curl-auth-header',
    description: 'Authorization token in curl header',
    regex: /curl\s.*-[hH]\s*['\"]?Authorization:\s*Bearer\s+([A-Za-z0-9_\-.~+/=]{20,})/i,
    keywords: ['curl'],
    entropy: 2.75,
    secretGroup: 1,
  },
  {
    id: 'curl-auth-user',
    description: 'Basic auth in curl command',
    regex: /curl\s.*-u\s+['\"]?([^'"\s]+:[^'"\s]+)/i,
    keywords: ['curl'],
    entropy: 2,
    secretGroup: 1,
  },

  // ─── Databricks ──────────────────────────────────────────────────────
  {
    id: 'databricks-token',
    description: 'Databricks API token',
    regex: /dapi[a-h0-9]{32}/,
    keywords: ['dapi'],
    entropy: 3,
  },

  // ─── Datadog ─────────────────────────────────────────────────────────
  {
    id: 'datadog-token',
    description: 'Datadog Access Token',
    regex: /(?:datadog)(?:.{0,40})([a-z0-9]{32,40})/i,
    keywords: ['datadog'],
    secretGroup: 1,
  },

  // ─── Defined Networking ──────────────────────────────────────────────
  {
    id: 'defined-networking-token',
    description: 'Defined Networking API token',
    regex: /dnkey-[A-Za-z0-9_-]{40,}/,
    keywords: ['dnkey'],
  },

  // ─── DigitalOcean ────────────────────────────────────────────────────
  {
    id: 'digitalocean-token',
    description: 'DigitalOcean OAuth Access Token',
    regex: /doo_v1_[a-f0-9]{64}/,
    keywords: ['doo_v1_'],
    entropy: 3,
  },
  {
    id: 'digitalocean-pat',
    description: 'DigitalOcean Personal Access Token',
    regex: /dop_v1_[a-f0-9]{64}/,
    keywords: ['dop_v1_'],
    entropy: 3,
  },
  {
    id: 'digitalocean-refresh-token',
    description: 'DigitalOcean OAuth Refresh Token',
    regex: /dor_v1_[a-f0-9]{64}/,
    keywords: ['dor_v1_'],
  },

  // ─── Discord ─────────────────────────────────────────────────────────
  {
    id: 'discord-token',
    description: 'Discord API token',
    regex: /(?:discord)(?:.{0,40})([A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,})/i,
    keywords: ['discord'],
    secretGroup: 1,
  },
  {
    id: 'discord-client-id',
    description: 'Discord client ID',
    regex: /(?:discord)(?:.{0,40})(\d{18})/i,
    keywords: ['discord'],
    entropy: 2,
    secretGroup: 1,
  },
  {
    id: 'discord-client-secret',
    description: 'Discord client secret',
    regex: /(?:discord)(?:.{0,40})([a-z0-9_-]{32})/i,
    keywords: ['discord'],
    entropy: 2,
    secretGroup: 1,
  },

  // ─── Doppler ─────────────────────────────────────────────────────────
  {
    id: 'doppler-token',
    description: 'Doppler API token',
    regex: /dp\.pt\.[A-Za-z0-9]{40,}/,
    keywords: ['dp.pt.'],
    entropy: 2,
  },

  // ─── DroneCI ─────────────────────────────────────────────────────────
  {
    id: 'droneci-token',
    description: 'DroneCI Access Token',
    regex: /(?:droneci)(?:.{0,40})([A-Za-z0-9]{32})/i,
    keywords: ['droneci'],
    secretGroup: 1,
  },

  // ─── Dropbox ─────────────────────────────────────────────────────────
  {
    id: 'dropbox-token',
    description: 'Dropbox API secret',
    regex: /(?:dropbox)(?:.{0,40})([a-z0-9]{15})/i,
    keywords: ['dropbox'],
    secretGroup: 1,
  },
  {
    id: 'dropbox-long-token',
    description: 'Dropbox long-lived API token',
    regex: /(?:dropbox)(?:.{0,40})(sl\.[A-Za-z0-9_-]{130,})/i,
    keywords: ['dropbox'],
    secretGroup: 1,
  },
  {
    id: 'dropbox-short-token',
    description: 'Dropbox short-lived API token',
    regex: /(?:dropbox)(?:.{0,40})(sl\.[A-Za-z0-9_-]{11,})/i,
    keywords: ['dropbox'],
    secretGroup: 1,
  },

  // ─── Duffel ──────────────────────────────────────────────────────────
  {
    id: 'duffel-token',
    description: 'Duffel API token',
    regex: /duffel_(?:test|live)_[A-Za-z0-9_-]{40,}/,
    keywords: ['duffel_'],
    entropy: 2,
  },

  // ─── Dynatrace ───────────────────────────────────────────────────────
  {
    id: 'dynatrace-token',
    description: 'Dynatrace API token',
    regex: /dt0c01\.[A-Z0-9]{24}\.[A-Z0-9]{64}/,
    keywords: ['dt0c01.'],
    entropy: 4,
  },

  // ─── EasyPost ────────────────────────────────────────────────────────
  {
    id: 'easypost-key',
    description: 'EasyPost API token',
    regex: /EZAK[A-Za-z0-9]{54}/,
    keywords: ['ezak'],
    entropy: 2,
  },
  {
    id: 'easypost-test-key',
    description: 'EasyPost test API token',
    regex: /EZTK[A-Za-z0-9]{54}/,
    keywords: ['eztk'],
    entropy: 2,
  },

  // ─── Etsy ────────────────────────────────────────────────────────────
  {
    id: 'etsy-token',
    description: 'Etsy Access Token',
    regex: /(?:etsy)(?:.{0,40})([a-z0-9]{24})/i,
    keywords: ['etsy'],
    entropy: 3,
    secretGroup: 1,
  },

  // ─── Facebook ────────────────────────────────────────────────────────
  {
    id: 'facebook-token',
    description: 'Facebook Access Token',
    regex: /(?:facebook)(?:.{0,40})(EAA[A-Za-z0-9]{30,})/i,
    keywords: ['facebook'],
    entropy: 3,
    secretGroup: 1,
  },
  {
    id: 'facebook-page-token',
    description: 'Facebook Page Access Token',
    regex: /EAA[A-Za-z0-9]{100,}/,
    entropy: 4,
  },
  {
    id: 'facebook-secret',
    description: 'Facebook Application secret',
    regex: /(?:facebook)(?:.{0,40})([0-9a-f]{32})/i,
    keywords: ['facebook'],
    entropy: 3,
    secretGroup: 1,
  },

  // ─── Fastly ──────────────────────────────────────────────────────────
  {
    id: 'fastly-key',
    description: 'Fastly API key',
    regex: /(?:fastly)(?:.{0,40})([A-Za-z0-9_-]{32})/i,
    keywords: ['fastly'],
    secretGroup: 1,
  },

  // ─── Finicity ────────────────────────────────────────────────────────
  {
    id: 'finicity-token',
    description: 'Finicity API token',
    regex: /(?:finicity)(?:.{0,40})([a-f0-9]{32})/i,
    keywords: ['finicity'],
    secretGroup: 1,
  },
  {
    id: 'finicity-secret',
    description: 'Finicity Client Secret',
    regex: /(?:finicity)(?:.{0,40})([A-Za-z0-9]{20})/i,
    keywords: ['finicity'],
    secretGroup: 1,
  },

  // ─── Finnhub ─────────────────────────────────────────────────────────
  {
    id: 'finnhub-token',
    description: 'Finnhub Access Token',
    regex: /(?:finnhub)(?:.{0,40})([A-Za-z0-9]{20})/i,
    keywords: ['finnhub'],
    secretGroup: 1,
  },

  // ─── Flickr ──────────────────────────────────────────────────────────
  {
    id: 'flickr-token',
    description: 'Flickr Access Token',
    regex: /(?:flickr)(?:.{0,40})([a-z0-9]{32})/i,
    keywords: ['flickr'],
    secretGroup: 1,
  },

  // ─── Flutterwave ─────────────────────────────────────────────────────
  {
    id: 'flutterwave-encryption-key',
    description: 'Flutterwave Encryption Key',
    regex: /FLWSECK_TEST-[a-h0-9]{12}/i,
    keywords: ['flwseck_test'],
    entropy: 2,
  },
  {
    id: 'flutterwave-public-key',
    description: 'Flutterwave Public Key',
    regex: /FLWPUBK_TEST-[a-h0-9]{32}/i,
    keywords: ['flwpubk_test'],
    entropy: 2,
  },
  {
    id: 'flutterwave-secret-key',
    description: 'Flutterwave Secret Key',
    regex: /FLWSECK_TEST-[a-h0-9]{32}/i,
    keywords: ['flwseck_test'],
    entropy: 2,
  },

  // ─── Fly.io ──────────────────────────────────────────────────────────
  {
    id: 'flyio-key',
    description: 'Fly.io API key',
    regex: /FlyV1\s+fm[12]_[A-Za-z0-9_-]{40,}/,
    entropy: 4,
  },

  // ─── Frame.io ────────────────────────────────────────────────────────
  {
    id: 'frameio-token',
    description: 'Frame.io API token',
    regex: /fio-u-[A-Za-z0-9_-]{60,}/,
    keywords: ['fio-u-'],
  },

  // ─── Freemius ────────────────────────────────────────────────────────
  {
    id: 'freemius-key',
    description: 'Freemius secret key',
    regex: /(?:secret_key)(?:.{0,40})(sk_[A-Za-z0-9]{32,64})/i,
    keywords: ['secret_key'],
    secretGroup: 1,
  },

  // ─── Freshbooks ──────────────────────────────────────────────────────
  {
    id: 'freshbooks-token',
    description: 'Freshbooks Access Token',
    regex: /(?:freshbooks)(?:.{0,40})([a-z0-9]{64})/i,
    keywords: ['freshbooks'],
    secretGroup: 1,
  },

  // ─── GCP ─────────────────────────────────────────────────────────────
  {
    id: 'gcp-key',
    description: 'GCP API key',
    regex: /AIza[A-Za-z0-9_-]{35}/,
    keywords: ['aiza'],
    entropy: 4,
  },

  // ─── Generic API key ─────────────────────────────────────────────────
  {
    id: 'generic-api-key',
    description: 'Generic API key',
    regex: /(?:api[_-]?key|apikey|api[_-]?secret|api[_-]?token|auth[_-]?token|access[_-]?token|secret[_-]?key|private[_-]?key|client[_-]?secret)[\s]*[=:]\s*['"]?([A-Za-z0-9_\-.~+/=]{16,})/i,
    entropy: 3.5,
    secretGroup: 1,
    useStopwords: true,
  },

  // ─── GitHub ──────────────────────────────────────────────────────────
  {
    id: 'github-app-token',
    description: 'GitHub App Token',
    regex: /(?:ghu|ghs)_[A-Za-z0-9]{36,255}/,
    entropy: 3,
  },
  {
    id: 'github-token',
    description: 'GitHub Fine-Grained Personal Access Token',
    regex: /github_pat_[A-Za-z0-9_]{82}/,
    keywords: ['github_pat_'],
    entropy: 3,
  },
  {
    id: 'github-oauth-token',
    description: 'GitHub OAuth Access Token',
    regex: /gho_[A-Za-z0-9]{36,255}/,
    keywords: ['gho_'],
    entropy: 3,
  },
  {
    id: 'github-pat',
    description: 'GitHub Personal Access Token',
    regex: /ghp_[A-Za-z0-9]{36,255}/,
    keywords: ['ghp_'],
    entropy: 3,
  },
  {
    id: 'github-refresh-token',
    description: 'GitHub Refresh Token',
    regex: /ghr_[A-Za-z0-9]{36,255}/,
    keywords: ['ghr_'],
    entropy: 3,
  },

  // ─── GitLab ──────────────────────────────────────────────────────────
  {
    id: 'gitlab-cicd-token',
    description: 'GitLab CI/CD Job Token',
    regex: /glcbt-[A-Za-z0-9]{20,}/,
    keywords: ['glcbt-'],
    entropy: 3,
  },
  {
    id: 'gitlab-deploy-token',
    description: 'GitLab Deploy Token',
    regex: /gldt-[A-Za-z0-9_-]{20,}/,
    keywords: ['gldt-'],
    entropy: 3,
  },
  {
    id: 'gitlab-feature-flag-token',
    description: 'GitLab feature flag client token',
    regex: /glffct-[A-Za-z0-9_-]{20,}/,
    keywords: ['glffct-'],
    entropy: 3,
  },
  {
    id: 'gitlab-feed-token',
    description: 'GitLab feed token',
    regex: /glft-[A-Za-z0-9_-]{20,}/,
    keywords: ['glft-'],
    entropy: 3,
  },
  {
    id: 'gitlab-mail-token',
    description: 'GitLab incoming mail token',
    regex: /glimt-[A-Za-z0-9_-]{20,}/,
    keywords: ['glimt-'],
    entropy: 3,
  },
  {
    id: 'gitlab-k8s-agent-token',
    description: 'GitLab Kubernetes Agent token',
    regex: /glagent-[A-Za-z0-9_-]{50,}/,
    keywords: ['glagent-'],
    entropy: 3,
  },
  {
    id: 'gitlab-oauth-secret',
    description: 'GitLab OIDC Application Secret',
    regex: /gloas-[a-f0-9]{64}/,
    keywords: ['gloas-'],
    entropy: 3,
  },
  {
    id: 'gitlab-pat',
    description: 'GitLab Personal Access Token',
    regex: /glpat-[A-Za-z0-9_-]{20,}/,
    keywords: ['glpat-'],
    entropy: 3,
  },
  {
    id: 'gitlab-pat-routable',
    description: 'GitLab Personal Access Token (routable)',
    regex: /glpat-[A-Za-z0-9_-]{20,}/,
    keywords: ['glpat-'],
    entropy: 4,
  },
  {
    id: 'gitlab-pipeline-token',
    description: 'GitLab Pipeline Trigger Token',
    regex: /glptt-[a-f0-9]{40}/,
    keywords: ['glptt-'],
    entropy: 3,
  },
  {
    id: 'gitlab-runner-reg-token',
    description: 'GitLab Runner Registration Token',
    regex: /GR1348941[A-Za-z0-9_-]{20,}/,
    keywords: ['gr1348941'],
    entropy: 3,
  },
  {
    id: 'gitlab-runner-auth-token',
    description: 'GitLab Runner Authentication Token',
    regex: /glrt-[A-Za-z0-9_-]{20,}/,
    keywords: ['glrt-'],
    entropy: 3,
  },
  {
    id: 'gitlab-runner-auth-routable',
    description: 'GitLab Runner Authentication Token (Routable)',
    regex: /glrt-[A-Za-z0-9_-]{20,}/,
    keywords: ['glrt-'],
    entropy: 4,
  },
  {
    id: 'gitlab-scim-token',
    description: 'GitLab SCIM Token',
    regex: /glsoat-[A-Za-z0-9_-]{20,}/,
    keywords: ['glsoat-'],
    entropy: 3,
  },
  {
    id: 'gitlab-session',
    description: 'GitLab Session Cookie',
    regex: /_gitlab_session=[A-Za-z0-9%_-]{32,}/,
    keywords: ['_gitlab_session='],
    entropy: 3,
  },

  // ─── Gitter ──────────────────────────────────────────────────────────
  {
    id: 'gitter-token',
    description: 'Gitter Access Token',
    regex: /(?:gitter)(?:.{0,40})([a-z0-9]{40})/i,
    keywords: ['gitter'],
    secretGroup: 1,
  },

  // ─── GoCardless ──────────────────────────────────────────────────────
  {
    id: 'gocardless-token',
    description: 'GoCardless API token',
    regex: /live_[A-Za-z0-9_-]{40,}/,
    useStopwords: true,
  },

  // ─── Grafana ─────────────────────────────────────────────────────────
  {
    id: 'grafana-key',
    description: 'Grafana API key',
    regex: /eyJrIjoi[A-Za-z0-9+/=]{40,}/,
    keywords: ['eyjrijoi'],
    entropy: 3,
  },
  {
    id: 'grafana-cloud-token',
    description: 'Grafana cloud API token',
    regex: /glc_[A-Za-z0-9+/=]{32,}/,
    keywords: ['glc_'],
    entropy: 3,
  },
  {
    id: 'grafana-service-token',
    description: 'Grafana service account token',
    regex: /glsa_[A-Za-z0-9]{32}_[A-Fa-f0-9]{8}/,
    keywords: ['glsa_'],
    entropy: 3,
  },

  // ─── Harness ─────────────────────────────────────────────────────────
  {
    id: 'harness-key',
    description: 'Harness Access Token (PAT or SAT)',
    regex: /(?:pat|sat)\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{20}/,
  },

  // ─── HashiCorp ───────────────────────────────────────────────────────
  {
    id: 'hashicorp-tf-token',
    description: 'HashiCorp Terraform API token',
    regex: /atlasv1\.[A-Za-z0-9_-]{60,}/,
    keywords: ['atlasv1'],
    entropy: 3.5,
  },
  {
    id: 'hashicorp-tf-password',
    description: 'HashiCorp Terraform password',
    regex: /(?:terraform)(?:.{0,40}password.{0,10})(['"][A-Za-z0-9_!@#$%^&*]{8,}['"])/i,
    entropy: 2,
    secretGroup: 1,
    useStopwords: true,
  },

  // ─── Heroku ──────────────────────────────────────────────────────────
  {
    id: 'heroku-key',
    description: 'Heroku API key',
    regex: /(?:heroku)(?:.{0,40})([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    keywords: ['heroku'],
    secretGroup: 1,
  },
  {
    id: 'heroku-key-v2',
    description: 'Heroku API key v2',
    regex: /hrku-aa[A-Za-z0-9_-]{46,}/,
    keywords: ['hrku-aa'],
    entropy: 4,
  },

  // ─── HubSpot ─────────────────────────────────────────────────────────
  {
    id: 'hubspot-key',
    description: 'HubSpot API token',
    regex: /(?:hubspot)(?:.{0,40})([a-z0-9]{8}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{12})/i,
    keywords: ['hubspot'],
    secretGroup: 1,
  },

  // ─── Hugging Face ────────────────────────────────────────────────────
  {
    id: 'huggingface-token',
    description: 'Hugging Face Access token',
    regex: /hf_[A-Za-z0-9]{34,}/,
    keywords: ['hf_'],
    entropy: 2,
  },
  {
    id: 'huggingface-org-token',
    description: 'Hugging Face Organization API token',
    regex: /api_org_[A-Za-z0-9]{34,}/,
    keywords: ['api_org_'],
    entropy: 2,
  },

  // ─── Infracost ───────────────────────────────────────────────────────
  {
    id: 'infracost-token',
    description: 'Infracost API token',
    regex: /ico-[A-Za-z0-9]{32}/,
    keywords: ['ico-'],
    entropy: 3,
  },

  // ─── Intercom ────────────────────────────────────────────────────────
  {
    id: 'intercom-key',
    description: 'Intercom API token',
    regex: /(?:intercom)(?:.{0,40})([a-z0-9=_-]{60})/i,
    keywords: ['intercom'],
    secretGroup: 1,
  },

  // ─── Intra42 ─────────────────────────────────────────────────────────
  {
    id: 'intra42-secret',
    description: 'Intra42 client secret',
    regex: /s-s4t2(?:af|ud)-[a-f0-9]{64}/,
    entropy: 3,
  },

  // ─── JFrog ───────────────────────────────────────────────────────────
  {
    id: 'jfrog-key',
    description: 'JFrog API key',
    regex: /(?:jfrog|artifactory|bintray|xray)(?:.{0,40})([A-Za-z0-9]{73})/i,
    secretGroup: 1,
  },
  {
    id: 'jfrog-identity-token',
    description: 'JFrog Identity Token',
    regex: /(?:jfrog|artifactory|bintray|xray)(?:.{0,40})([A-Za-z0-9_-]{64})/i,
    secretGroup: 1,
  },

  // ─── JWT ─────────────────────────────────────────────────────────────
  {
    id: 'jwt-token',
    description: 'JSON Web Token',
    regex: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_\-+/=]{10,}/,
    keywords: ['ey'],
    entropy: 3,
  },
  {
    id: 'jwt-base64',
    description: 'Base64-encoded JSON Web Token',
    regex: /ZXlK[A-Za-z0-9+/=]{20,}\.[A-Za-z0-9+/=]{20,}\.[A-Za-z0-9+/=]{20,}/,
    keywords: ['zxlk'],
    entropy: 2,
  },

  // ─── Kraken ──────────────────────────────────────────────────────────
  {
    id: 'kraken-token',
    description: 'Kraken Access Token',
    regex: /(?:kraken)(?:.{0,40})([A-Za-z0-9/+]{40,}={0,2})/i,
    keywords: ['kraken'],
    secretGroup: 1,
  },

  // ─── Kubernetes ──────────────────────────────────────────────────────
  {
    id: 'k8s-secret',
    description: 'Kubernetes Secret in YAML',
    regex: /(?:kind:\s*Secret[\s\S]{0,200}data:[\s\S]{0,200})([A-Za-z0-9+/=]{20,})/i,
    keywords: ['secret'],
    secretGroup: 1,
  },

  // ─── KuCoin ──────────────────────────────────────────────────────────
  {
    id: 'kucoin-token',
    description: 'KuCoin Access Token',
    regex: /(?:kucoin)(?:.{0,40})([a-f0-9]{24})/i,
    keywords: ['kucoin'],
    secretGroup: 1,
  },
  {
    id: 'kucoin-secret',
    description: 'KuCoin Secret Key',
    regex: /(?:kucoin)(?:.{0,40})([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    keywords: ['kucoin'],
    secretGroup: 1,
  },

  // ─── LaunchDarkly ────────────────────────────────────────────────────
  {
    id: 'launchdarkly-token',
    description: 'LaunchDarkly Access Token',
    regex: /(?:launchdarkly)(?:.{0,40})(api-[a-f0-9-]{36})/i,
    keywords: ['launchdarkly'],
    secretGroup: 1,
  },

  // ─── Linear ──────────────────────────────────────────────────────────
  {
    id: 'linear-key',
    description: 'Linear API token',
    regex: /lin_api_[A-Za-z0-9]{40}/,
    keywords: ['lin_api_'],
    entropy: 2,
  },
  {
    id: 'linear-secret',
    description: 'Linear Client Secret',
    regex: /(?:linear)(?:.{0,40})([a-f0-9]{32})/i,
    keywords: ['linear'],
    entropy: 2,
    secretGroup: 1,
  },

  // ─── LinkedIn ────────────────────────────────────────────────────────
  {
    id: 'linkedin-client-id',
    description: 'LinkedIn Client ID',
    regex: /(?:linkedin)(?:.{0,40})([a-z0-9]{14})/i,
    entropy: 2,
    secretGroup: 1,
  },
  {
    id: 'linkedin-client-secret',
    description: 'LinkedIn Client Secret',
    regex: /(?:linkedin)(?:.{0,40})([A-Za-z0-9]{16})/i,
    entropy: 2,
    secretGroup: 1,
  },

  // ─── Lob ─────────────────────────────────────────────────────────────
  {
    id: 'lob-key',
    description: 'Lob API key',
    regex: /(?:live|test)_[a-f0-9]{35}/,
  },
  {
    id: 'lob-pub-key',
    description: 'Lob Publishable API key',
    regex: /(?:live|test)_pub_[a-f0-9]{31}/,
  },

  // ─── Looker ──────────────────────────────────────────────────────────
  {
    id: 'looker-client-id',
    description: 'Looker Client ID',
    regex: /(?:looker)(?:.{0,40})([A-Za-z0-9]{20})/i,
    keywords: ['looker'],
    secretGroup: 1,
  },
  {
    id: 'looker-client-secret',
    description: 'Looker Client Secret',
    regex: /(?:looker)(?:.{0,40})([A-Za-z0-9]{24})/i,
    keywords: ['looker'],
    secretGroup: 1,
  },

  // ─── Mailchimp ───────────────────────────────────────────────────────
  {
    id: 'mailchimp-key',
    description: 'Mailchimp API key',
    regex: /(?:mailchimp)(?:.{0,40})([a-f0-9]{32}-us\d{1,2})/i,
    keywords: ['mailchimp'],
    secretGroup: 1,
  },

  // ─── Mailgun ─────────────────────────────────────────────────────────
  {
    id: 'mailgun-private-key',
    description: 'Mailgun private API token',
    regex: /(?:mailgun)(?:.{0,40})(key-[a-f0-9]{32})/i,
    keywords: ['mailgun'],
    secretGroup: 1,
  },
  {
    id: 'mailgun-pub-key',
    description: 'Mailgun public validation key',
    regex: /(?:mailgun)(?:.{0,40})(pubkey-[a-f0-9]{32})/i,
    keywords: ['mailgun'],
    secretGroup: 1,
  },
  {
    id: 'mailgun-signing-key',
    description: 'Mailgun webhook signing key',
    regex: /(?:mailgun)(?:.{0,40})([a-h0-9]{32}-[a-h0-9]{8}-[a-h0-9]{8})/i,
    keywords: ['mailgun'],
    secretGroup: 1,
  },

  // ─── MapBox ──────────────────────────────────────────────────────────
  {
    id: 'mapbox-token',
    description: 'MapBox API token',
    regex: /(?:mapbox)(?:.{0,40})((?:pk|sk|tk)\.[A-Za-z0-9_-]{60,})/i,
    keywords: ['mapbox'],
    secretGroup: 1,
  },

  // ─── Mattermost ──────────────────────────────────────────────────────
  {
    id: 'mattermost-token',
    description: 'Mattermost Access Token',
    regex: /(?:mattermost)(?:.{0,40})([a-z0-9]{26})/i,
    keywords: ['mattermost'],
    secretGroup: 1,
  },

  // ─── MaxMind ─────────────────────────────────────────────────────────
  {
    id: 'maxmind-key',
    description: 'MaxMind license key',
    regex: /[a-zA-Z0-9]{6}_mmk_[A-Za-z0-9]{25,}/,
    keywords: ['_mmk'],
    entropy: 4,
  },

  // ─── MessageBird ─────────────────────────────────────────────────────
  {
    id: 'messagebird-token',
    description: 'MessageBird API token',
    regex: /(?:messagebird|message_bird)(?:.{0,40})([a-z0-9]{25})/i,
    secretGroup: 1,
  },
  {
    id: 'messagebird-client-id',
    description: 'MessageBird client ID',
    regex: /(?:messagebird|message_bird)(?:.{0,40})([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    secretGroup: 1,
  },

  // ─── Microsoft Teams ─────────────────────────────────────────────────
  {
    id: 'teams-webhook',
    description: 'Microsoft Teams Webhook',
    regex: /https:\/\/[a-z0-9]+\.webhook\.office\.com\/webhookb2\/[a-z0-9-]+@[a-z0-9-]+\/IncomingWebhook\/[a-z0-9]+\/[a-z0-9-]+/i,
  },

  // ─── Netlify ─────────────────────────────────────────────────────────
  {
    id: 'netlify-token',
    description: 'Netlify Access Token',
    regex: /(?:netlify)(?:.{0,40})([A-Za-z0-9_-]{40,46})/i,
    keywords: ['netlify'],
    secretGroup: 1,
  },

  // ─── New Relic ───────────────────────────────────────────────────────
  {
    id: 'newrelic-browser-token',
    description: 'New Relic ingest browser API token',
    regex: /NRJS-[a-f0-9]{19}/,
    keywords: ['nrjs-'],
  },
  {
    id: 'newrelic-insert-key',
    description: 'New Relic insight insert key',
    regex: /NRII-[A-Za-z0-9_-]{32}/,
    keywords: ['nrii-'],
  },
  {
    id: 'newrelic-user-id',
    description: 'New Relic user API ID',
    regex: /(?:new.?relic)(?:.{0,40})([a-z0-9]{64})/i,
    secretGroup: 1,
  },
  {
    id: 'newrelic-user-key',
    description: 'New Relic user API key',
    regex: /NRAK-[A-Z0-9]{27}/,
    keywords: ['nrak'],
  },

  // ─── Notion ──────────────────────────────────────────────────────────
  {
    id: 'notion-token',
    description: 'Notion API token',
    regex: /ntn_[A-Za-z0-9]{40,}/,
    keywords: ['ntn_'],
    entropy: 4,
  },

  // ─── npm ─────────────────────────────────────────────────────────────
  {
    id: 'npm-token',
    description: 'npm access token',
    regex: /npm_[A-Za-z0-9]{36}/,
    keywords: ['npm_'],
    entropy: 2,
  },

  // ─── NuGet ───────────────────────────────────────────────────────────
  {
    id: 'nuget-password',
    description: 'NuGet config password',
    regex: /<add\s+key=["']clearTextPassword["']\s+value=["']([^"']+)["']/i,
    keywords: ['<add key='],
    entropy: 1,
    secretGroup: 1,
  },

  // ─── NYTimes ─────────────────────────────────────────────────────────
  {
    id: 'nytimes-token',
    description: 'NYTimes Access Token',
    regex: /(?:nytimes|new.?york.?times)(?:.{0,40})([A-Za-z0-9]{32})/i,
    secretGroup: 1,
  },

  // ─── Octopus Deploy ──────────────────────────────────────────────────
  {
    id: 'octopus-deploy-key',
    description: 'Octopus Deploy API key',
    regex: /API-[A-Z0-9]{30}/,
    keywords: ['api-'],
    entropy: 3,
  },

  // ─── Okta ────────────────────────────────────────────────────────────
  {
    id: 'okta-token',
    description: 'Okta Access Token',
    regex: /(?:okta)(?:.{0,40})(00[A-Za-z0-9_-]{40})/i,
    keywords: ['okta'],
    entropy: 4,
    secretGroup: 1,
  },

  // ─── OpenAI ──────────────────────────────────────────────────────────
  {
    id: 'openai-key',
    description: 'OpenAI API key',
    regex: /sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}/,
    keywords: ['t3blbkfj'],
    entropy: 3,
  },

  // ─── OpenShift ───────────────────────────────────────────────────────
  {
    id: 'openshift-token',
    description: 'OpenShift user token',
    regex: /sha256~[A-Za-z0-9_-]{43}/,
    keywords: ['sha256~'],
    entropy: 3.5,
  },

  // ─── Perplexity ──────────────────────────────────────────────────────
  {
    id: 'perplexity-key',
    description: 'Perplexity API key',
    regex: /pplx-[a-f0-9]{48}/,
    keywords: ['pplx-'],
    entropy: 4,
  },

  // ─── PKCS#12 ─────────────────────────────────────────────────────────
  {
    id: 'pkcs12-file',
    description: 'PKCS #12 file (may contain private keys)',
    regex: /MIIJ[A-Za-z0-9+/=]{100,}/,
  },

  // ─── Plaid ───────────────────────────────────────────────────────────
  {
    id: 'plaid-token',
    description: 'Plaid API token',
    regex: /(?:plaid)(?:.{0,40})(access-(?:sandbox|development|production)-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i,
    keywords: ['plaid'],
    secretGroup: 1,
  },
  {
    id: 'plaid-client-id',
    description: 'Plaid Client ID',
    regex: /(?:plaid)(?:.{0,40})([a-f0-9]{24})/i,
    keywords: ['plaid'],
    entropy: 3.5,
    secretGroup: 1,
  },
  {
    id: 'plaid-secret',
    description: 'Plaid Secret key',
    regex: /(?:plaid)(?:.{0,40})([a-f0-9]{30})/i,
    keywords: ['plaid'],
    entropy: 3.5,
    secretGroup: 1,
  },

  // ─── PlanetScale ─────────────────────────────────────────────────────
  {
    id: 'planetscale-token',
    description: 'PlanetScale API token',
    regex: /pscale_tkn_[A-Za-z0-9_-]{32,}/,
    keywords: ['pscale_tkn_'],
    entropy: 3,
  },
  {
    id: 'planetscale-oauth',
    description: 'PlanetScale OAuth token',
    regex: /pscale_oauth_[A-Za-z0-9_-]{32,}/,
    keywords: ['pscale_oauth_'],
    entropy: 3,
  },
  {
    id: 'planetscale-password',
    description: 'PlanetScale password',
    regex: /pscale_pw_[A-Za-z0-9_-]{32,}/,
    keywords: ['pscale_pw_'],
    entropy: 3,
  },

  // ─── Postman ─────────────────────────────────────────────────────────
  {
    id: 'postman-token',
    description: 'Postman API token',
    regex: /PMAK-[A-Za-z0-9]{24}-[A-Za-z0-9]{34}/,
    keywords: ['pmak-'],
    entropy: 3,
  },

  // ─── Prefect ─────────────────────────────────────────────────────────
  {
    id: 'prefect-token',
    description: 'Prefect API token',
    regex: /pnu_[A-Za-z0-9]{36}/,
    keywords: ['pnu_'],
    entropy: 2,
  },

  // ─── Private Key ─────────────────────────────────────────────────────
  {
    id: 'private-key',
    description: 'Private Key (PEM format)',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
    keywords: ['-----begin'],
  },

  // ─── PrivateAI ───────────────────────────────────────────────────────
  {
    id: 'privateai-token',
    description: 'PrivateAI API token',
    regex: /[a-z0-9]{64}/,
    entropy: 3,
    useStopwords: true,
    // This is very generic — only match with high entropy and stopwords
  },

  // ─── Pulumi ──────────────────────────────────────────────────────────
  {
    id: 'pulumi-token',
    description: 'Pulumi API token',
    regex: /pul-[a-f0-9]{40}/,
    keywords: ['pul-'],
    entropy: 2,
  },

  // ─── PyPI ────────────────────────────────────────────────────────────
  {
    id: 'pypi-token',
    description: 'PyPI upload token',
    regex: /pypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,}/,
    keywords: ['pypi-ageichlwas5vcmc'],
    entropy: 3,
  },

  // ─── RapidAPI ────────────────────────────────────────────────────────
  {
    id: 'rapidapi-token',
    description: 'RapidAPI Access Token',
    regex: /(?:rapidapi)(?:.{0,40})([a-z0-9]{50})/i,
    keywords: ['rapidapi'],
    secretGroup: 1,
  },

  // ─── Readme ──────────────────────────────────────────────────────────
  {
    id: 'readme-token',
    description: 'Readme API token',
    regex: /rdme_[A-Za-z0-9]{70}/,
    keywords: ['rdme_'],
    entropy: 2,
  },

  // ─── RubyGems ────────────────────────────────────────────────────────
  {
    id: 'rubygems-token',
    description: 'RubyGems API token',
    regex: /rubygems_[a-f0-9]{48}/,
    keywords: ['rubygems_'],
    entropy: 2,
  },

  // ─── Scalingo ────────────────────────────────────────────────────────
  {
    id: 'scalingo-token',
    description: 'Scalingo API token',
    regex: /tk-us-[A-Za-z0-9_-]{48}/,
    keywords: ['tk-us-'],
    entropy: 2,
  },

  // ─── Sendbird ────────────────────────────────────────────────────────
  {
    id: 'sendbird-id',
    description: 'Sendbird Access ID',
    regex: /(?:sendbird)(?:.{0,40})([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    keywords: ['sendbird'],
    secretGroup: 1,
  },
  {
    id: 'sendbird-token',
    description: 'Sendbird Access Token',
    regex: /(?:sendbird)(?:.{0,40})([a-f0-9]{40})/i,
    keywords: ['sendbird'],
    secretGroup: 1,
  },

  // ─── SendGrid ────────────────────────────────────────────────────────
  {
    id: 'sendgrid-token',
    description: 'SendGrid API token',
    regex: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/,
    keywords: ['sg.'],
    entropy: 2,
  },

  // ─── Sendinblue ──────────────────────────────────────────────────────
  {
    id: 'sendinblue-token',
    description: 'Sendinblue API token',
    regex: /xkeysib-[a-f0-9]{64}-[A-Za-z0-9]{16}/,
    keywords: ['xkeysib-'],
    entropy: 2,
  },

  // ─── Sentry ──────────────────────────────────────────────────────────
  {
    id: 'sentry-token',
    description: 'Sentry Access Token',
    regex: /(?:sentry)(?:.{0,40})([a-f0-9]{64})/i,
    keywords: ['sentry'],
    entropy: 3,
    secretGroup: 1,
  },
  {
    id: 'sentry-org-token',
    description: 'Sentry Organization Token',
    regex: /sntrys_eyJpYXQio[A-Za-z0-9_-]{60,}/,
    keywords: ['sntrys_eyjpyxqio'],
    entropy: 4.5,
  },
  {
    id: 'sentry-user-token',
    description: 'Sentry User Token',
    regex: /sntryu_[A-Za-z0-9]{60,}/,
    keywords: ['sntryu_'],
    entropy: 3.5,
  },

  // ─── Settlemint ──────────────────────────────────────────────────────
  {
    id: 'settlemint-app-token',
    description: 'Settlemint Application Access Token',
    regex: /sm_aat_[A-Za-z0-9]{40,}/,
    keywords: ['sm_aat'],
    entropy: 3,
  },
  {
    id: 'settlemint-pat',
    description: 'Settlemint Personal Access Token',
    regex: /sm_pat_[A-Za-z0-9]{40,}/,
    keywords: ['sm_pat'],
    entropy: 3,
  },
  {
    id: 'settlemint-service-token',
    description: 'Settlemint Service Access Token',
    regex: /sm_sat_[A-Za-z0-9]{40,}/,
    keywords: ['sm_sat'],
    entropy: 3,
  },

  // ─── Shippo ──────────────────────────────────────────────────────────
  {
    id: 'shippo-token',
    description: 'Shippo API token',
    regex: /shippo_(?:live|test)_[a-f0-9]{40}/,
    keywords: ['shippo_'],
    entropy: 2,
  },

  // ─── Shopify ─────────────────────────────────────────────────────────
  {
    id: 'shopify-token',
    description: 'Shopify access token',
    regex: /shpat_[a-f0-9]{32}/,
    keywords: ['shpat_'],
    entropy: 2,
  },
  {
    id: 'shopify-custom-token',
    description: 'Shopify custom access token',
    regex: /shpca_[a-f0-9]{32}/,
    keywords: ['shpca_'],
    entropy: 2,
  },
  {
    id: 'shopify-private-token',
    description: 'Shopify private app access token',
    regex: /shppa_[a-f0-9]{32}/,
    keywords: ['shppa_'],
    entropy: 2,
  },
  {
    id: 'shopify-shared-secret',
    description: 'Shopify shared secret',
    regex: /shpss_[a-f0-9]{32}/,
    keywords: ['shpss_'],
    entropy: 2,
  },

  // ─── Sidekiq ─────────────────────────────────────────────────────────
  {
    id: 'sidekiq-secret',
    description: 'Sidekiq secret',
    regex: /(?:BUNDLE_ENTERPRISE__CONTRIBSYS__COM|BUNDLE_GEMS__CONTRIBSYS__COM)(?:.{0,40})([a-f0-9]{8}:[a-f0-9]{8})/i,
    secretGroup: 1,
  },
  {
    id: 'sidekiq-url',
    description: 'Sidekiq sensitive URL',
    regex: /(?:https?:\/\/)([a-f0-9]{8}:[a-f0-9]{8})@(?:enterprise|gems)\.contribsys\.com/i,
    secretGroup: 1,
  },

  // ─── Slack ───────────────────────────────────────────────────────────
  {
    id: 'slack-app-token',
    description: 'Slack App-level token',
    regex: /xapp-[0-9]+-[A-Za-z0-9]+-[0-9]+-[A-Za-z0-9]+/,
    keywords: ['xapp'],
    entropy: 2,
  },
  {
    id: 'slack-bot-token',
    description: 'Slack Bot token',
    regex: /xoxb-[0-9]{10,13}-[0-9]{10,13}-[A-Za-z0-9]{24}/,
    keywords: ['xoxb'],
    entropy: 3,
  },
  {
    id: 'slack-config-token',
    description: 'Slack Configuration access token',
    regex: /xoxe\.xox[bp]-[0-9]-[A-Za-z0-9]{160,}/,
    entropy: 2,
  },
  {
    id: 'slack-config-refresh-token',
    description: 'Slack Configuration refresh token',
    regex: /xoxe-[0-9]-[A-Za-z0-9]{140,}/,
    keywords: ['xoxe-'],
    entropy: 2,
  },
  {
    id: 'slack-legacy-bot-token',
    description: 'Slack Legacy bot token',
    regex: /xoxb-[0-9]{8,14}-[A-Za-z0-9]{18,26}/,
    keywords: ['xoxb'],
    entropy: 2,
  },
  {
    id: 'slack-legacy-token',
    description: 'Slack Legacy token',
    regex: /xox[os]-[0-9]{10,13}-[0-9]{10,13}-[A-Za-z0-9]{24,34}/,
    entropy: 2,
  },
  {
    id: 'slack-legacy-workspace-token',
    description: 'Slack Legacy Workspace token',
    regex: /xoxa-[0-9]+-[A-Za-z0-9]+-[0-9]+-[A-Za-z0-9]+/,
    entropy: 2,
  },
  {
    id: 'slack-user-token',
    description: 'Slack User token',
    regex: /xoxp-[0-9]{10,13}-[0-9]{10,13}-[0-9]{10,13}-[a-z0-9]{32}/,
    entropy: 2,
  },
  {
    id: 'slack-webhook',
    description: 'Slack Webhook URL',
    regex: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{1,}\/B[A-Z0-9]{1,}\/[A-Za-z0-9]{1,}/,
    keywords: ['hooks.slack.com'],
  },

  // ─── Snyk ────────────────────────────────────────────────────────────
  {
    id: 'snyk-token',
    description: 'Snyk API token',
    regex: /(?:snyk)(?:.{0,40})([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    keywords: ['snyk'],
    secretGroup: 1,
  },

  // ─── Sonar ───────────────────────────────────────────────────────────
  {
    id: 'sonar-token',
    description: 'Sonar API token',
    regex: /(?:sonar)(?:.{0,40})(sq[apu]_[a-z0-9]{40})/i,
    keywords: ['sonar'],
    secretGroup: 1,
  },

  // ─── Sourcegraph ─────────────────────────────────────────────────────
  {
    id: 'sourcegraph-token',
    description: 'Sourcegraph access token',
    regex: /sgp_(?:[a-f0-9]{16}_)?[a-f0-9]{40}/,
    entropy: 3,
  },

  // ─── Square ──────────────────────────────────────────────────────────
  {
    id: 'square-token',
    description: 'Square Access Token',
    regex: /sq0atp-[A-Za-z0-9_-]{22}/,
    entropy: 2,
  },

  // ─── Squarespace ─────────────────────────────────────────────────────
  {
    id: 'squarespace-token',
    description: 'Squarespace Access Token',
    regex: /(?:squarespace)(?:.{0,40})([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    keywords: ['squarespace'],
    secretGroup: 1,
  },

  // ─── Stripe ──────────────────────────────────────────────────────────
  {
    id: 'stripe-key',
    description: 'Stripe API key',
    regex: /(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,99}/,
    entropy: 2,
  },

  // ─── SumoLogic ───────────────────────────────────────────────────────
  {
    id: 'sumologic-id',
    description: 'SumoLogic Access ID',
    regex: /(?:sumo)(?:.{0,40})(su[a-z0-9]{12})/i,
    keywords: ['sumo'],
    entropy: 3,
    secretGroup: 1,
  },
  {
    id: 'sumologic-token',
    description: 'SumoLogic Access Token',
    regex: /(?:sumo)(?:.{0,40})([A-Za-z0-9]{64})/i,
    keywords: ['sumo'],
    entropy: 3,
    secretGroup: 1,
  },

  // ─── Telegram ────────────────────────────────────────────────────────
  {
    id: 'telegram-token',
    description: 'Telegram Bot API token',
    regex: /[0-9]{5,10}:[A-Za-z0-9_-]{35}/,
    keywords: ['telegr'],
  },

  // ─── Travis CI ───────────────────────────────────────────────────────
  {
    id: 'travisci-token',
    description: 'Travis CI Access Token',
    regex: /(?:travis)(?:.{0,40})([A-Za-z0-9]{22})/i,
    keywords: ['travis'],
    secretGroup: 1,
  },

  // ─── Twilio ──────────────────────────────────────────────────────────
  {
    id: 'twilio-key',
    description: 'Twilio API key',
    regex: /SK[a-f0-9]{32}/,
    keywords: ['sk'],
    entropy: 3,
  },

  // ─── Twitch ──────────────────────────────────────────────────────────
  {
    id: 'twitch-token',
    description: 'Twitch API token',
    regex: /(?:twitch)(?:.{0,40})([a-z0-9]{30})/i,
    keywords: ['twitch'],
    secretGroup: 1,
  },

  // ─── Twitter ─────────────────────────────────────────────────────────
  {
    id: 'twitter-access-secret',
    description: 'Twitter Access Secret',
    regex: /(?:twitter)(?:.{0,40})([A-Za-z0-9]{45})/i,
    keywords: ['twitter'],
    secretGroup: 1,
  },
  {
    id: 'twitter-access-token',
    description: 'Twitter Access Token',
    regex: /(?:twitter)(?:.{0,40})(\d+-[A-Za-z0-9]{40})/i,
    keywords: ['twitter'],
    secretGroup: 1,
  },
  {
    id: 'twitter-api-key',
    description: 'Twitter API key',
    regex: /(?:twitter)(?:.{0,40})([A-Za-z0-9]{25})/i,
    keywords: ['twitter'],
    secretGroup: 1,
  },
  {
    id: 'twitter-api-secret',
    description: 'Twitter API secret',
    regex: /(?:twitter)(?:.{0,40})([A-Za-z0-9]{50})/i,
    keywords: ['twitter'],
    secretGroup: 1,
  },
  {
    id: 'twitter-bearer-token',
    description: 'Twitter Bearer Token',
    regex: /(?:twitter)(?:.{0,40})(AAAAAAAAAAAAAAAAAAAAA[A-Za-z0-9%]{20,})/i,
    keywords: ['twitter'],
    secretGroup: 1,
  },

  // ─── Typeform ────────────────────────────────────────────────────────
  {
    id: 'typeform-token',
    description: 'Typeform API token',
    regex: /tfp_[A-Za-z0-9_-]{40,}/,
    keywords: ['tfp_'],
  },

  // ─── Vault ───────────────────────────────────────────────────────────
  {
    id: 'vault-batch-token',
    description: 'Vault Batch Token',
    regex: /hvb\.[A-Za-z0-9_-]{24,}/,
    keywords: ['hvb.'],
    entropy: 4,
  },
  {
    id: 'vault-service-token',
    description: 'Vault Service Token',
    regex: /hvs\.[A-Za-z0-9_-]{24,}/,
    entropy: 3.5,
  },

  // ─── Yandex ──────────────────────────────────────────────────────────
  {
    id: 'yandex-token',
    description: 'Yandex Access Token',
    regex: /(?:yandex)(?:.{0,40})(t1\.[A-Za-z0-9_-]{66}\.[A-Za-z0-9_-]{86})/i,
    keywords: ['yandex'],
    secretGroup: 1,
  },
  {
    id: 'yandex-key',
    description: 'Yandex API key',
    regex: /(?:yandex)(?:.{0,40})(AQVN[A-Za-z0-9_-]{35,38})/i,
    keywords: ['yandex'],
    secretGroup: 1,
  },
  {
    id: 'yandex-aws-token',
    description: 'Yandex AWS Access Token',
    regex: /(?:yandex)(?:.{0,40})(YC[A-Za-z0-9_-]{38})/i,
    keywords: ['yandex'],
    secretGroup: 1,
  },

  // ─── Zendesk ─────────────────────────────────────────────────────────
  {
    id: 'zendesk-key',
    description: 'Zendesk Secret Key',
    regex: /(?:zendesk)(?:.{0,40})([A-Za-z0-9]{40})/i,
    keywords: ['zendesk'],
    secretGroup: 1,
  },
]
