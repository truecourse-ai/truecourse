# Gitleaks Secret Detection Rules

> Source: https://github.com/gitleaks/gitleaks/blob/master/config/gitleaks.toml
> Total rules: 222

## Rules

| # | Rule ID | Description | Entropy | Keywords |
|---|---------|-------------|---------|----------|
| 1 | `1password-secret-key` | Uncovered a possible 1Password secret key, potentially compromising access to secrets in vaults. | 3.8 | `a3-` |
| 2 | `1password-service-account-token` | Uncovered a possible 1Password service account token, potentially compromising access to secrets in vaults. | 4 | `ops_` |
| 3 | `adafruit-api-key` | Identified a potential Adafruit API Key, which could lead to unauthorized access to Adafruit services and sensitive d... | - | `adafruit` |
| 4 | `adobe-client-id` | Detected a pattern that resembles an Adobe OAuth Web Client ID, posing a risk of compromised Adobe integrations and d... | 2 | `adobe` |
| 5 | `adobe-client-secret` | Discovered a potential Adobe Client Secret, which, if exposed, could allow unauthorized Adobe service access and data... | 2 | `p8e-` |
| 6 | `age-secret-key` | Discovered a potential Age encryption tool secret key, risking data decryption and unauthorized access to sensitive i... | - | `age-secret-key-1` |
| 7 | `airtable-api-key` | Uncovered a possible Airtable API Key, potentially compromising database access and leading to data leakage or altera... | - | `airtable` |
| 8 | `airtable-personnal-access-token` | Uncovered a possible Airtable Personal AccessToken, potentially compromising database access and leading to data leak... | - | `airtable` |
| 9 | `algolia-api-key` | Identified an Algolia API Key, which could result in unauthorized search operations and data exposure on Algolia-mana... | - | `algolia` |
| 10 | `alibaba-access-key-id` | Detected an Alibaba Cloud AccessKey ID, posing a risk of unauthorized cloud resource access and potential data compro... | 2 | `ltai` |
| 11 | `alibaba-secret-key` | Discovered a potential Alibaba Cloud Secret Key, potentially allowing unauthorized operations and data access within ... | 2 | `alibaba` |
| 12 | `anthropic-admin-api-key` | Detected an Anthropic Admin API Key, risking unauthorized access to administrative functions and sensitive AI model c... | - | `sk-ant-admin01` |
| 13 | `anthropic-api-key` | Identified an Anthropic API Key, which may compromise AI assistant integrations and expose sensitive data to unauthor... | - | `sk-ant-api03` |
| 14 | `artifactory-api-key` | Detected an Artifactory api key, posing a risk unauthorized access to the central repository. | 4.5 | `akcp` |
| 15 | `artifactory-reference-token` | Detected an Artifactory reference token, posing a risk of impersonation and unauthorized access to the central reposi... | 4.5 | `cmvmd` |
| 16 | `asana-client-id` | Discovered a potential Asana Client ID, risking unauthorized access to Asana projects and sensitive task information. | - | `asana` |
| 17 | `asana-client-secret` | Identified an Asana Client Secret, which could lead to compromised project management integrity and unauthorized access. | - | `asana` |
| 18 | `atlassian-api-token` | Detected an Atlassian API token, posing a threat to project management and collaboration tool security and data confi... | 3.5 | - |
| 19 | `authress-service-client-access-key` | Uncovered a possible Authress Service Client Access Key, which may compromise access control services and sensitive d... | 2 | - |
| 20 | `aws-access-token` | Identified a pattern that may indicate AWS credentials, risking unauthorized cloud resource access and data breaches ... | 3 | - |
| 21 | `aws-amazon-bedrock-api-key-long-lived` | Identified a pattern that may indicate long-lived Amazon Bedrock API keys, risking unauthorized Amazon Bedrock usage | 3 | `absk` |
| 22 | `aws-amazon-bedrock-api-key-short-lived` | Identified a pattern that may indicate short-lived Amazon Bedrock API keys, risking unauthorized Amazon Bedrock usage | 3 | `bedrock-api-key-` |
| 23 | `azure-ad-client-secret` | Azure AD Client Secret | 3 | `q~` |
| 24 | `beamer-api-token` | Detected a Beamer API token, potentially compromising content management and exposing sensitive notifications and upd... | - | `beamer` |
| 25 | `bitbucket-client-id` | Discovered a potential Bitbucket Client ID, risking unauthorized repository access and potential codebase exposure. | - | `bitbucket` |
| 26 | `bitbucket-client-secret` | Discovered a potential Bitbucket Client Secret, posing a risk of compromised code repositories and unauthorized access. | - | `bitbucket` |
| 27 | `bittrex-access-key` | Identified a Bittrex Access Key, which could lead to unauthorized access to cryptocurrency trading accounts and finan... | - | `bittrex` |
| 28 | `bittrex-secret-key` | Detected a Bittrex Secret Key, potentially compromising cryptocurrency transactions and financial security. | - | `bittrex` |
| 29 | `cisco-meraki-api-key` | Cisco Meraki is a cloud-managed IT solution that provides networking, security, and device management through an easy... | 3 | `meraki` |
| 30 | `clickhouse-cloud-api-secret-key` | Identified a pattern that may indicate clickhouse cloud API secret key, risking unauthorized clickhouse cloud api acc... | 3 | `4b1d` |
| 31 | `clojars-api-token` | Uncovered a possible Clojars API token, risking unauthorized access to Clojure libraries and potential code manipulat... | 2 | `clojars_` |
| 32 | `cloudflare-api-key` | Detected a Cloudflare API Key, potentially compromising cloud application deployments and operational security. | 2 | `cloudflare` |
| 33 | `cloudflare-global-api-key` | Detected a Cloudflare Global API Key, potentially compromising cloud application deployments and operational security. | 2 | `cloudflare` |
| 34 | `cloudflare-origin-ca-key` | Detected a Cloudflare Origin CA Key, potentially compromising cloud application deployments and operational security. | 2 | - |
| 35 | `codecov-access-token` | Found a pattern resembling a Codecov Access Token, posing a risk of unauthorized access to code coverage reports and ... | - | `codecov` |
| 36 | `cohere-api-token` | Identified a Cohere Token, posing a risk of unauthorized access to AI services and data manipulation. | 4 | - |
| 37 | `coinbase-access-token` | Detected a Coinbase Access Token, posing a risk of unauthorized access to cryptocurrency accounts and financial trans... | - | `coinbase` |
| 38 | `confluent-access-token` | Identified a Confluent Access Token, which could compromise access to streaming data platforms and sensitive data flow. | - | `confluent` |
| 39 | `confluent-secret-key` | Found a Confluent Secret Key, potentially risking unauthorized operations and data access within Confluent services. | - | `confluent` |
| 40 | `contentful-delivery-api-token` | Discovered a Contentful delivery API token, posing a risk to content management systems and data integrity. | - | `contentful` |
| 41 | `curl-auth-header` | Discovered a potential authorization token provided in a curl command header, which could compromise the curl accesse... | 2.75 | `curl` |
| 42 | `curl-auth-user` | Discovered a potential basic authorization token provided in a curl command, which could compromise the curl accessed... | 2 | `curl` |
| 43 | `databricks-api-token` | Uncovered a Databricks API token, which may compromise big data analytics platforms and sensitive data processing. | 3 | `dapi` |
| 44 | `datadog-access-token` | Detected a Datadog Access Token, potentially risking monitoring and analytics data exposure and manipulation. | - | `datadog` |
| 45 | `defined-networking-api-token` | Identified a Defined Networking API token, which could lead to unauthorized network operations and data breaches. | - | `dnkey` |
| 46 | `digitalocean-access-token` | Found a DigitalOcean OAuth Access Token, risking unauthorized cloud resource access and data compromise. | 3 | `doo_v1_` |
| 47 | `digitalocean-pat` | Discovered a DigitalOcean Personal Access Token, posing a threat to cloud infrastructure security and data privacy. | 3 | `dop_v1_` |
| 48 | `digitalocean-refresh-token` | Uncovered a DigitalOcean OAuth Refresh Token, which could allow prolonged unauthorized access and resource manipulation. | - | `dor_v1_` |
| 49 | `discord-api-token` | Detected a Discord API key, potentially compromising communication channels and user data privacy on Discord. | - | `discord` |
| 50 | `discord-client-id` | Identified a Discord client ID, which may lead to unauthorized integrations and data exposure in Discord applications. | 2 | `discord` |
| 51 | `discord-client-secret` | Discovered a potential Discord client secret, risking compromised Discord bot integrations and data leaks. | 2 | `discord` |
| 52 | `doppler-api-token` | Discovered a Doppler API token, posing a risk to environment and secrets management security. | 2 | `dp.pt.` |
| 53 | `droneci-access-token` | Detected a Droneci Access Token, potentially compromising continuous integration and deployment workflows. | - | `droneci` |
| 54 | `dropbox-api-token` | Identified a Dropbox API secret, which could lead to unauthorized file access and data breaches in Dropbox storage. | - | `dropbox` |
| 55 | `dropbox-long-lived-api-token` | Found a Dropbox long-lived API token, risking prolonged unauthorized access to cloud storage and sensitive data. | - | `dropbox` |
| 56 | `dropbox-short-lived-api-token` | Discovered a Dropbox short-lived API token, posing a risk of temporary but potentially harmful data access and manipu... | - | `dropbox` |
| 57 | `duffel-api-token` | Uncovered a Duffel API token, which may compromise travel platform integrations and sensitive customer data. | 2 | `duffel_` |
| 58 | `dynatrace-api-token` | Detected a Dynatrace API token, potentially risking application performance monitoring and data exposure. | 4 | `dt0c01.` |
| 59 | `easypost-api-token` | Identified an EasyPost API token, which could lead to unauthorized postal and shipment service access and data exposure. | 2 | `ezak` |
| 60 | `easypost-test-api-token` | Detected an EasyPost test API token, risking exposure of test environments and potentially sensitive shipment data. | 2 | `eztk` |
| 61 | `etsy-access-token` | Found an Etsy Access Token, potentially compromising Etsy shop management and customer data. | 3 | `etsy` |
| 62 | `facebook-access-token` | Discovered a Facebook Access Token, posing a risk of unauthorized access to Facebook accounts and personal data expos... | 3 | `facebook` |
| 63 | `facebook-page-access-token` | Discovered a Facebook Page Access Token, posing a risk of unauthorized access to Facebook accounts and personal data ... | 4 | - |
| 64 | `facebook-secret` | Discovered a Facebook Application secret, posing a risk of unauthorized access to Facebook accounts and personal data... | 3 | `facebook` |
| 65 | `fastly-api-token` | Uncovered a Fastly API key, which may compromise CDN and edge cloud services, leading to content delivery and securit... | - | `fastly` |
| 66 | `finicity-api-token` | Detected a Finicity API token, potentially risking financial data access and unauthorized financial operations. | - | `finicity` |
| 67 | `finicity-client-secret` | Identified a Finicity Client Secret, which could lead to compromised financial service integrations and data breaches. | - | `finicity` |
| 68 | `finnhub-access-token` | Found a Finnhub Access Token, risking unauthorized access to financial market data and analytics. | - | `finnhub` |
| 69 | `flickr-access-token` | Discovered a Flickr Access Token, posing a risk of unauthorized photo management and potential data leakage. | - | `flickr` |
| 70 | `flutterwave-encryption-key` | Uncovered a Flutterwave Encryption Key, which may compromise payment processing and sensitive financial information. | 2 | `flwseck_test` |
| 71 | `flutterwave-public-key` | Detected a Finicity Public Key, potentially exposing public cryptographic operations and integrations. | 2 | `flwpubk_test` |
| 72 | `flutterwave-secret-key` | Identified a Flutterwave Secret Key, risking unauthorized financial transactions and data breaches. | 2 | `flwseck_test` |
| 73 | `flyio-access-token` | Uncovered a Fly.io API key | 4 | - |
| 74 | `frameio-api-token` | Found a Frame.io API token, potentially compromising video collaboration and project management. | - | `fio-u-` |
| 75 | `freemius-secret-key` | Detected a Freemius secret key, potentially exposing sensitive information. | - | `secret_key` |
| 76 | `freshbooks-access-token` | Discovered a Freshbooks Access Token, posing a risk to accounting software access and sensitive financial data exposure. | - | `freshbooks` |
| 77 | `gcp-api-key` | Uncovered a GCP API key, which could lead to unauthorized access to Google Cloud services and data breaches. | 4 | `aiza` |
| 78 | `generic-api-key` | Allowlist for Generic API Keys | 3.5 | - |
| 79 | `github-app-token` | Identified a GitHub App Token, which may compromise GitHub application integrations and source code security. | 3 | - |
| 80 | `github-fine-grained-pat` | Found a GitHub Fine-Grained Personal Access Token, risking unauthorized repository access and code manipulation. | 3 | `github_pat_` |
| 81 | `github-oauth` | Discovered a GitHub OAuth Access Token, posing a risk of compromised GitHub account integrations and data leaks. | 3 | `gho_` |
| 82 | `github-pat` | Uncovered a GitHub Personal Access Token, potentially leading to unauthorized repository access and sensitive content... | 3 | `ghp_` |
| 83 | `github-refresh-token` | Detected a GitHub Refresh Token, which could allow prolonged unauthorized access to GitHub services. | 3 | `ghr_` |
| 84 | `gitlab-cicd-job-token` | Identified a GitLab CI/CD Job Token, potential access to projects and some APIs on behalf of a user while the CI job ... | 3 | `glcbt-` |
| 85 | `gitlab-deploy-token` | Identified a GitLab Deploy Token, risking access to repositories, packages and containers with write access. | 3 | `gldt-` |
| 86 | `gitlab-feature-flag-client-token` | Identified a GitLab feature flag client token, risks exposing user lists and features flags used by an application. | 3 | `glffct-` |
| 87 | `gitlab-feed-token` | Identified a GitLab feed token, risking exposure of user data. | 3 | `glft-` |
| 88 | `gitlab-incoming-mail-token` | Identified a GitLab incoming mail token, risking manipulation of data sent by mail. | 3 | `glimt-` |
| 89 | `gitlab-kubernetes-agent-token` | Identified a GitLab Kubernetes Agent token, risking access to repos and registry of projects connected via agent. | 3 | `glagent-` |
| 90 | `gitlab-oauth-app-secret` | Identified a GitLab OIDC Application Secret, risking access to apps using GitLab as authentication provider. | 3 | `gloas-` |
| 91 | `gitlab-pat` | Identified a GitLab Personal Access Token, risking unauthorized access to GitLab repositories and codebase exposure. | 3 | `glpat-` |
| 92 | `gitlab-pat-routable` | Identified a GitLab Personal Access Token (routable), risking unauthorized access to GitLab repositories and codebase... | 4 | `glpat-` |
| 93 | `gitlab-ptt` | Found a GitLab Pipeline Trigger Token, potentially compromising continuous integration workflows and project security. | 3 | `glptt-` |
| 94 | `gitlab-rrt` | Discovered a GitLab Runner Registration Token, posing a risk to CI/CD pipeline integrity and unauthorized access. | 3 | `gr1348941` |
| 95 | `gitlab-runner-authentication-token` | Discovered a GitLab Runner Authentication Token, posing a risk to CI/CD pipeline integrity and unauthorized access. | 3 | `glrt-` |
| 96 | `gitlab-runner-authentication-token-routable` | Discovered a GitLab Runner Authentication Token (Routable), posing a risk to CI/CD pipeline integrity and unauthorize... | 4 | `glrt-` |
| 97 | `gitlab-scim-token` | Discovered a GitLab SCIM Token, posing a risk to unauthorized access for a organization or instance. | 3 | `glsoat-` |
| 98 | `gitlab-session-cookie` | Discovered a GitLab Session Cookie, posing a risk to unauthorized access to a user account. | 3 | `_gitlab_session=` |
| 99 | `gitter-access-token` | Uncovered a Gitter Access Token, which may lead to unauthorized access to chat and communication services. | - | `gitter` |
| 100 | `gocardless-api-token` | Detected a GoCardless API token, potentially risking unauthorized direct debit payment operations and financial data ... | - | - |
| 101 | `grafana-api-key` | Identified a Grafana API key, which could compromise monitoring dashboards and sensitive data analytics. | 3 | `eyjrijoi` |
| 102 | `grafana-cloud-api-token` | Found a Grafana cloud API token, risking unauthorized access to cloud-based monitoring services and data exposure. | 3 | `glc_` |
| 103 | `grafana-service-account-token` | Discovered a Grafana service account token, posing a risk of compromised monitoring services and data integrity. | 3 | `glsa_` |
| 104 | `harness-api-key` | Identified a Harness Access Token (PAT or SAT), risking unauthorized access to a Harness account. | - | - |
| 105 | `hashicorp-tf-api-token` | Uncovered a HashiCorp Terraform user/org API token, which may lead to unauthorized infrastructure management and secu... | 3.5 | `atlasv1` |
| 106 | `hashicorp-tf-password` | Identified a HashiCorp Terraform password field, risking unauthorized infrastructure configuration and security breac... | 2 | - |
| 107 | `heroku-api-key` | Detected a Heroku API Key, potentially compromising cloud application deployments and operational security. | - | `heroku` |
| 108 | `heroku-api-key-v2` | Detected a Heroku API Key, potentially compromising cloud application deployments and operational security. | 4 | `hrku-aa` |
| 109 | `hubspot-api-key` | Found a HubSpot API Token, posing a risk to CRM data integrity and unauthorized marketing operations. | - | `hubspot` |
| 110 | `huggingface-access-token` | Discovered a Hugging Face Access token, which could lead to unauthorized access to AI models and sensitive data. | 2 | `hf_` |
| 111 | `huggingface-organization-api-token` | Uncovered a Hugging Face Organization API token, potentially compromising AI organization accounts and associated data. | 2 | `api_org_` |
| 112 | `infracost-api-token` | Detected an Infracost API Token, risking unauthorized access to cloud cost estimation tools and financial data. | 3 | `ico-` |
| 113 | `intercom-api-key` | Identified an Intercom API Token, which could compromise customer communication channels and data privacy. | - | `intercom` |
| 114 | `intra42-client-secret` | Found a Intra42 client secret, which could lead to unauthorized access to the 42School API and sensitive data. | 3 | - |
| 115 | `jfrog-api-key` | Found a JFrog API Key, posing a risk of unauthorized access to software artifact repositories and build pipelines. | - | - |
| 116 | `jfrog-identity-token` | Discovered a JFrog Identity Token, potentially compromising access to JFrog services and sensitive software artifacts. | - | - |
| 117 | `jwt` | Uncovered a JSON Web Token, which may lead to unauthorized access to web applications and sensitive user data. | 3 | `ey` |
| 118 | `jwt-base64` | Detected a Base64-encoded JSON Web Token, posing a risk of exposing encoded authentication and data exchange informat... | 2 | `zxlk` |
| 119 | `kraken-access-token` | Identified a Kraken Access Token, potentially compromising cryptocurrency trading accounts and financial security. | - | `kraken` |
| 120 | `kubernetes-secret-yaml` | Possible Kubernetes Secret detected, posing a risk of leaking credentials/tokens from your deployments | - | `secret` |
| 121 | `kucoin-access-token` | Found a Kucoin Access Token, risking unauthorized access to cryptocurrency exchange services and transactions. | - | `kucoin` |
| 122 | `kucoin-secret-key` | Discovered a Kucoin Secret Key, which could lead to compromised cryptocurrency operations and financial data breaches. | - | `kucoin` |
| 123 | `launchdarkly-access-token` | Uncovered a Launchdarkly Access Token, potentially compromising feature flag management and application functionality. | - | `launchdarkly` |
| 124 | `linear-api-key` | Detected a Linear API Token, posing a risk to project management tools and sensitive task data. | 2 | `lin_api_` |
| 125 | `linear-client-secret` | Identified a Linear Client Secret, which may compromise secure integrations and sensitive project management data. | 2 | `linear` |
| 126 | `linkedin-client-id` | Found a LinkedIn Client ID, risking unauthorized access to LinkedIn integrations and professional data exposure. | 2 | - |
| 127 | `linkedin-client-secret` | Discovered a LinkedIn Client secret, potentially compromising LinkedIn application integrations and user data. | 2 | - |
| 128 | `lob-api-key` | Uncovered a Lob API Key, which could lead to unauthorized access to mailing and address verification services. | - | - |
| 129 | `lob-pub-api-key` | Detected a Lob Publishable API Key, posing a risk of exposing mail and print service integrations. | - | - |
| 130 | `looker-client-id` | Found a Looker Client ID, risking unauthorized access to a Looker account and exposing sensitive data. | - | `looker` |
| 131 | `looker-client-secret` | Found a Looker Client Secret, risking unauthorized access to a Looker account and exposing sensitive data. | - | `looker` |
| 132 | `mailchimp-api-key` | Identified a Mailchimp API key, potentially compromising email marketing campaigns and subscriber data. | - | `mailchimp` |
| 133 | `mailgun-private-api-token` | Found a Mailgun private API token, risking unauthorized email service operations and data breaches. | - | `mailgun` |
| 134 | `mailgun-pub-key` | Discovered a Mailgun public validation key, which could expose email verification processes and associated data. | - | `mailgun` |
| 135 | `mailgun-signing-key` | Uncovered a Mailgun webhook signing key, potentially compromising email automation and data integrity. | - | `mailgun` |
| 136 | `mapbox-api-token` | Detected a MapBox API token, posing a risk to geospatial services and sensitive location data exposure. | - | `mapbox` |
| 137 | `mattermost-access-token` | Identified a Mattermost Access Token, which may compromise team communication channels and data privacy. | - | `mattermost` |
| 138 | `maxmind-license-key` | Discovered a potential MaxMind license key. | 4 | `_mmk` |
| 139 | `messagebird-api-token` | Found a MessageBird API token, risking unauthorized access to communication platforms and message data. | - | - |
| 140 | `messagebird-client-id` | Discovered a MessageBird client ID, potentially compromising API integrations and sensitive communication data. | - | - |
| 141 | `microsoft-teams-webhook` | Uncovered a Microsoft Teams Webhook, which could lead to unauthorized access to team collaboration tools and data leaks. | - | - |
| 142 | `netlify-access-token` | Detected a Netlify Access Token, potentially compromising web hosting services and site management. | - | `netlify` |
| 143 | `new-relic-browser-api-token` | Identified a New Relic ingest browser API token, risking unauthorized access to application performance data and anal... | - | `nrjs-` |
| 144 | `new-relic-insert-key` | Discovered a New Relic insight insert key, compromising data injection into the platform. | - | `nrii-` |
| 145 | `new-relic-user-api-id` | Found a New Relic user API ID, posing a risk to application monitoring services and data integrity. | - | - |
| 146 | `new-relic-user-api-key` | Discovered a New Relic user API Key, which could lead to compromised application insights and performance monitoring. | - | `nrak` |
| 147 | `notion-api-token` | Notion API token | 4 | `ntn_` |
| 148 | `npm-access-token` | Uncovered an npm access token, potentially compromising package management and code repository access. | 2 | `npm_` |
| 149 | `nuget-config-password` | Identified a password within a Nuget config file, potentially compromising package management access. | 1 | `<add key=` |
| 150 | `nytimes-access-token` | Detected a Nytimes Access Token, risking unauthorized access to New York Times APIs and content services. | - | - |
| 151 | `octopus-deploy-api-key` | Discovered a potential Octopus Deploy API key, risking application deployments and operational security. | 3 | `api-` |
| 152 | `okta-access-token` | Identified an Okta Access Token, which may compromise identity management services and user authentication data. | 4 | `okta` |
| 153 | `openai-api-key` | Found an OpenAI API Key, posing a risk of unauthorized access to AI services and data manipulation. | 3 | `t3blbkfj` |
| 154 | `openshift-user-token` | Found an OpenShift user token, potentially compromising an OpenShift/Kubernetes cluster. | 3.5 | `sha256~` |
| 155 | `perplexity-api-key` | Detected a Perplexity API key, which could lead to unauthorized access to Perplexity AI services and data exposure. | 4 | `pplx-` |
| 156 | `pkcs12-file` | Found a PKCS #12 file, which commonly contain bundled private keys. | - | - |
| 157 | `plaid-api-token` | Discovered a Plaid API Token, potentially compromising financial data aggregation and banking services. | - | `plaid` |
| 158 | `plaid-client-id` | Uncovered a Plaid Client ID, which could lead to unauthorized financial service integrations and data breaches. | 3.5 | `plaid` |
| 159 | `plaid-secret-key` | Detected a Plaid Secret key, risking unauthorized access to financial accounts and sensitive transaction data. | 3.5 | `plaid` |
| 160 | `planetscale-api-token` | Identified a PlanetScale API token, potentially compromising database management and operations. | 3 | `pscale_tkn_` |
| 161 | `planetscale-oauth-token` | Found a PlanetScale OAuth token, posing a risk to database access control and sensitive data integrity. | 3 | `pscale_oauth_` |
| 162 | `planetscale-password` | Discovered a PlanetScale password, which could lead to unauthorized database operations and data breaches. | 3 | `pscale_pw_` |
| 163 | `postman-api-token` | Uncovered a Postman API token, potentially compromising API testing and development workflows. | 3 | `pmak-` |
| 164 | `prefect-api-token` | Detected a Prefect API token, risking unauthorized access to workflow management and automation services. | 2 | `pnu_` |
| 165 | `private-key` | Identified a Private Key, which may compromise cryptographic security and sensitive data encryption. | - | `-----begin` |
| 166 | `privateai-api-token` | Identified a PrivateAI Token, posing a risk of unauthorized access to AI services and data manipulation. | 3 | - |
| 167 | `pulumi-api-token` | Found a Pulumi API token, posing a risk to infrastructure as code services and cloud resource management. | 2 | `pul-` |
| 168 | `pypi-upload-token` | Discovered a PyPI upload token, potentially compromising Python package distribution and repository integrity. | 3 | `pypi-ageichlwas5vcmc` |
| 169 | `rapidapi-access-token` | Uncovered a RapidAPI Access Token, which could lead to unauthorized access to various APIs and data services. | - | `rapidapi` |
| 170 | `readme-api-token` | Detected a Readme API token, risking unauthorized documentation management and content exposure. | 2 | `rdme_` |
| 171 | `rubygems-api-token` | Identified a Rubygem API token, potentially compromising Ruby library distribution and package management. | 2 | `rubygems_` |
| 172 | `scalingo-api-token` | Found a Scalingo API token, posing a risk to cloud platform services and application deployment security. | 2 | `tk-us-` |
| 173 | `sendbird-access-id` | Discovered a Sendbird Access ID, which could compromise chat and messaging platform integrations. | - | `sendbird` |
| 174 | `sendbird-access-token` | Uncovered a Sendbird Access Token, potentially risking unauthorized access to communication services and user data. | - | `sendbird` |
| 175 | `sendgrid-api-token` | Detected a SendGrid API token, posing a risk of unauthorized email service operations and data exposure. | 2 | `sg.` |
| 176 | `sendinblue-api-token` | Identified a Sendinblue API token, which may compromise email marketing services and subscriber data privacy. | 2 | `xkeysib-` |
| 177 | `sentry-access-token` | Found a Sentry.io Access Token (old format), risking unauthorized access to error tracking services and sensitive app... | 3 | `sentry` |
| 178 | `sentry-org-token` | Found a Sentry.io Organization Token, risking unauthorized access to error tracking services and sensitive applicatio... | 4.5 | `sntrys_eyjpyxqio` |
| 179 | `sentry-user-token` | Found a Sentry.io User Token, risking unauthorized access to error tracking services and sensitive application data. | 3.5 | `sntryu_` |
| 180 | `settlemint-application-access-token` | Found a Settlemint Application Access Token. | 3 | `sm_aat` |
| 181 | `settlemint-personal-access-token` | Found a Settlemint Personal Access Token. | 3 | `sm_pat` |
| 182 | `settlemint-service-access-token` | Found a Settlemint Service Access Token. | 3 | `sm_sat` |
| 183 | `shippo-api-token` | Discovered a Shippo API token, potentially compromising shipping services and customer order data. | 2 | `shippo_` |
| 184 | `shopify-access-token` | Uncovered a Shopify access token, which could lead to unauthorized e-commerce platform access and data breaches. | 2 | `shpat_` |
| 185 | `shopify-custom-access-token` | Detected a Shopify custom access token, potentially compromising custom app integrations and e-commerce data security. | 2 | `shpca_` |
| 186 | `shopify-private-app-access-token` | Identified a Shopify private app access token, risking unauthorized access to private app data and store operations. | 2 | `shppa_` |
| 187 | `shopify-shared-secret` | Found a Shopify shared secret, posing a risk to application authentication and e-commerce platform security. | 2 | `shpss_` |
| 188 | `sidekiq-secret` | Discovered a Sidekiq Secret, which could lead to compromised background job processing and application data breaches. | - | - |
| 189 | `sidekiq-sensitive-url` | Uncovered a Sidekiq Sensitive URL, potentially exposing internal job queues and sensitive operation details. | - | - |
| 190 | `slack-app-token` | Detected a Slack App-level token, risking unauthorized access to Slack applications and workspace data. | 2 | `xapp` |
| 191 | `slack-bot-token` | Identified a Slack Bot token, which may compromise bot integrations and communication channel security. | 3 | `xoxb` |
| 192 | `slack-config-access-token` | Found a Slack Configuration access token, posing a risk to workspace configuration and sensitive data access. | 2 | - |
| 193 | `slack-config-refresh-token` | Discovered a Slack Configuration refresh token, potentially allowing prolonged unauthorized access to configuration s... | 2 | `xoxe-` |
| 194 | `slack-legacy-bot-token` | Uncovered a Slack Legacy bot token, which could lead to compromised legacy bot operations and data exposure. | 2 | `xoxb` |
| 195 | `slack-legacy-token` | Detected a Slack Legacy token, risking unauthorized access to older Slack integrations and user data. | 2 | - |
| 196 | `slack-legacy-workspace-token` | Identified a Slack Legacy Workspace token, potentially compromising access to workspace data and legacy features. | 2 | - |
| 197 | `slack-user-token` | Found a Slack User token, posing a risk of unauthorized user impersonation and data access within Slack workspaces. | 2 | - |
| 198 | `slack-webhook-url` | Discovered a Slack Webhook, which could lead to unauthorized message posting and data leakage in Slack channels. | - | `hooks.slack.com` |
| 199 | `snyk-api-token` | Uncovered a Snyk API token, potentially compromising software vulnerability scanning and code security. | - | `snyk` |
| 200 | `sonar-api-token` | Uncovered a Sonar API token, potentially compromising software vulnerability scanning and code security. | - | `sonar` |
| 201 | `sourcegraph-access-token` | Sourcegraph is a code search and navigation engine. | 3 | - |
| 202 | `square-access-token` | Detected a Square Access Token, risking unauthorized payment processing and financial transaction exposure. | 2 | - |
| 203 | `squarespace-access-token` | Identified a Squarespace Access Token, which may compromise website management and content control on Squarespace. | - | `squarespace` |
| 204 | `stripe-access-token` | Found a Stripe Access Token, posing a risk to payment processing services and sensitive financial data. | 2 | - |
| 205 | `sumologic-access-id` | Discovered a SumoLogic Access ID, potentially compromising log management services and data analytics integrity. | 3 | `sumo` |
| 206 | `sumologic-access-token` | Uncovered a SumoLogic Access Token, which could lead to unauthorized access to log data and analytics insights. | 3 | `sumo` |
| 207 | `telegram-bot-api-token` | Detected a Telegram Bot API Token, risking unauthorized bot operations and message interception on Telegram. | - | `telegr` |
| 208 | `travisci-access-token` | Identified a Travis CI Access Token, potentially compromising continuous integration services and codebase security. | - | `travis` |
| 209 | `twilio-api-key` | Found a Twilio API Key, posing a risk to communication services and sensitive customer interaction data. | 3 | `sk` |
| 210 | `twitch-api-token` | Discovered a Twitch API token, which could compromise streaming services and account integrations. | - | `twitch` |
| 211 | `twitter-access-secret` | Uncovered a Twitter Access Secret, potentially risking unauthorized Twitter integrations and data breaches. | - | `twitter` |
| 212 | `twitter-access-token` | Detected a Twitter Access Token, posing a risk of unauthorized account operations and social media data exposure. | - | `twitter` |
| 213 | `twitter-api-key` | Identified a Twitter API Key, which may compromise Twitter application integrations and user data security. | - | `twitter` |
| 214 | `twitter-api-secret` | Found a Twitter API Secret, risking the security of Twitter app integrations and sensitive data access. | - | `twitter` |
| 215 | `twitter-bearer-token` | Discovered a Twitter Bearer Token, potentially compromising API access and data retrieval from Twitter. | - | `twitter` |
| 216 | `typeform-api-token` | Uncovered a Typeform API token, which could lead to unauthorized survey management and data collection. | - | `tfp_` |
| 217 | `vault-batch-token` | Detected a Vault Batch Token, risking unauthorized access to secret management services and sensitive data. | 4 | `hvb.` |
| 218 | `vault-service-token` | Identified a Vault Service Token, potentially compromising infrastructure security and access to sensitive credentials. | 3.5 | - |
| 219 | `yandex-access-token` | Found a Yandex Access Token, posing a risk to Yandex service integrations and user data privacy. | - | `yandex` |
| 220 | `yandex-api-key` | Discovered a Yandex API Key, which could lead to unauthorized access to Yandex services and data manipulation. | - | `yandex` |
| 221 | `yandex-aws-access-token` | Uncovered a Yandex AWS Access Token, potentially compromising cloud resource access and data security on Yandex Cloud. | - | `yandex` |
| 222 | `zendesk-secret-key` | Detected a Zendesk Secret Key, risking unauthorized access to customer support services and sensitive ticketing data. | - | `zendesk` |
