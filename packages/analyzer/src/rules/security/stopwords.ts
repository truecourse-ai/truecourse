/**
 * Stopwords for false-positive suppression in secret scanning.
 * When any stopword appears as a substring in the captured secret value, the match is suppressed.
 */

export const STOPWORDS: string[] = [
  // Programming concepts
  'abstract', 'accessor', 'adapter', 'algorithm', 'annotation', 'anonymous', 'argument',
  'assertion', 'assignment', 'asynchronous', 'attribute', 'autoload', 'autowired',

  // Languages & frameworks
  'android', 'angular', 'apache', 'assembly', 'backbone', 'bootstrap', 'clojure', 'coffeescript',
  'cplusplus', 'csharp', 'dartlang', 'delphi', 'django', 'dotnet', 'elixir', 'ember',
  'erlang', 'express', 'fastapi', 'flutter', 'fortran', 'gatsby', 'golang', 'grails',
  'haskell', 'hibernate', 'javascript', 'jupyter', 'kotlin', 'laravel', 'lua', 'matlab',
  'nextjs', 'nodejs', 'nuxtjs', 'objective', 'ocaml', 'pascal', 'perl', 'phoenix',
  'python', 'rails', 'react', 'ruby', 'rust', 'scala', 'spring', 'svelte', 'swift',
  'symfony', 'typescript', 'unity', 'vuejs',

  // Infrastructure & tools
  'ansible', 'apache', 'archive', 'artifactory', 'autoscale', 'azure', 'bamboo', 'bitbucket',
  'buildkite', 'caddy', 'centos', 'circleci', 'cloudflare', 'cloudformation', 'cloudwatch',
  'cockroach', 'consul', 'container', 'datadog', 'debian', 'docker', 'dockercompose',
  'dockerfile', 'druid', 'dynamodb', 'elastic', 'elasticsearch', 'envoy', 'etcd', 'fargate',
  'firebase', 'fluentd', 'github', 'gitlab', 'grafana', 'haproxy', 'hashicorp', 'helm',
  'heroku', 'homebrew', 'istio', 'jaeger', 'jenkins', 'jira', 'kafka', 'kibana',
  'kubernetes', 'linkerd', 'linux', 'logstash', 'marathon', 'memcached', 'mesos', 'minikube',
  'mongodb', 'mysql', 'nagios', 'netlify', 'newrelic', 'nginx', 'nomad', 'openshift',
  'packer', 'podman', 'postgres', 'postgresql', 'prometheus', 'proxmox', 'puppet', 'rabbitmq',
  'rancher', 'redis', 'registry', 'selenium', 'sentry', 'serverless', 'solr', 'sonarqube',
  'splunk', 'sqlite', 'terraform', 'traefik', 'travis', 'ubuntu', 'vagrant', 'vault',
  'vercel', 'virtualbox', 'vmware', 'webpack', 'windows', 'zabbix', 'zookeeper',

  // Software concepts
  'abstract', 'account', 'admin', 'administrator', 'algorithm', 'analytics', 'application',
  'architecture', 'async', 'authentication', 'authorization', 'automate', 'automation',
  'backend', 'backup', 'balance', 'bandwidth', 'baseline', 'batch', 'benchmark', 'binary',
  'binding', 'blueprint', 'boolean', 'bootstrap', 'breakpoint', 'broadcast', 'browser',
  'buffer', 'build', 'bundle', 'bytecode',

  // C words
  'cache', 'callback', 'calendar', 'candidate', 'capability', 'capture', 'catalog',
  'category', 'certificate', 'channel', 'changelog', 'character', 'checkpoint', 'chrome',
  'cipher', 'circuit', 'class', 'cleanup', 'client', 'clipboard', 'clone', 'closure',
  'cluster', 'codec', 'collection', 'column', 'command', 'commit', 'communicate',
  'community', 'compare', 'compatibility', 'compile', 'compiler', 'component', 'composite',
  'compress', 'compute', 'concatenate', 'concurrency', 'condition', 'config', 'configuration',
  'conflict', 'connect', 'connection', 'connector', 'console', 'constant', 'constraint',
  'constructor', 'consumer', 'container', 'content', 'context', 'contract', 'controller',
  'convention', 'conversion', 'converter', 'cookie', 'coordinator', 'coroutine', 'coverage',
  'credential', 'crontab', 'crossorigin', 'currency', 'cursor', 'custom', 'cycle',

  // D words
  'daemon', 'dashboard', 'database', 'dataframe', 'dataset', 'deadline', 'deadlock',
  'debug', 'debugger', 'declaration', 'decorator', 'default', 'deferred', 'delegate',
  'dependency', 'deploy', 'deployment', 'deprecate', 'deprecated', 'deserialize',
  'desktop', 'destination', 'destructor', 'development', 'device', 'diagnostic',
  'dictionary', 'digest', 'directive', 'directory', 'disable', 'discovery', 'dispatch',
  'display', 'distributed', 'document', 'documentation', 'download', 'driver', 'dropdown',
  'duplicate', 'duration', 'dynamic',

  // E words
  'element', 'email', 'embed', 'emitter', 'enable', 'encode', 'encoder', 'encoding',
  'encrypt', 'encryption', 'endpoint', 'engine', 'enterprise', 'entity', 'entry',
  'enumerate', 'environment', 'ephemeral', 'error', 'escape', 'evaluate', 'event',
  'example', 'exception', 'exchange', 'exclude', 'execute', 'execution', 'executor',
  'exercise', 'expand', 'experiment', 'export', 'expression', 'extension', 'external',
  'extract',

  // F words
  'facade', 'factory', 'failover', 'fallback', 'feature', 'federated', 'feedback',
  'fetch', 'field', 'filename', 'filesystem', 'filter', 'firewall', 'fixture',
  'flagged', 'flatten', 'float', 'flyweight', 'folder', 'footer', 'format', 'formatter',
  'forward', 'fragment', 'framework', 'frequency', 'frontend', 'function', 'functional',

  // G words
  'garbage', 'gateway', 'generate', 'generator', 'generic', 'global', 'google',
  'graceful', 'gradle', 'graphql', 'group', 'guard', 'guideline',

  // H words
  'handler', 'handshake', 'hardcode', 'hardware', 'header', 'health', 'healthcheck',
  'heartbeat', 'helper', 'hierarchy', 'histogram', 'homepage', 'hostname', 'hotfix',
  'hybrid',

  // I words
  'identity', 'idempotent', 'immutable', 'implement', 'implementation', 'import',
  'include', 'increment', 'index', 'indexer', 'indicator', 'infinite', 'inflate',
  'infrastructure', 'ingress', 'inherit', 'initial', 'initialize', 'injection',
  'inline', 'input', 'insert', 'inspect', 'install', 'instance', 'integration',
  'integrity', 'interceptor', 'interface', 'internal', 'interpolate', 'interrupt',
  'interval', 'introspect', 'invalidate', 'invoke', 'isolation', 'iterable', 'iterator',

  // J words
  'javascript', 'jobqueue', 'journal',

  // K words
  'kernel', 'keychain', 'keystore', 'keyword',

  // L words
  'lambda', 'language', 'latency', 'launcher', 'layout', 'lazy', 'leader', 'legacy',
  'library', 'lifecycle', 'lightweight', 'limiter', 'linear', 'linker', 'listener',
  'literal', 'loader', 'localhost', 'locale', 'logging', 'lookup',

  // M words
  'machine', 'manager', 'manifest', 'mapping', 'markdown', 'marshal', 'mediator',
  'memento', 'memory', 'merge', 'message', 'metadata', 'method', 'metric',
  'microservice', 'middleware', 'migrate', 'migration', 'milestone', 'minify',
  'minimum', 'mockup', 'model', 'modifier', 'module', 'monitor', 'monitoring',
  'monolith', 'monorepo', 'multipart', 'multiplexer', 'multithread', 'mutable', 'mutex',

  // N words
  'namespace', 'native', 'navigate', 'navigation', 'nested', 'network', 'notification',
  'nullable',

  // O words
  'object', 'observable', 'observer', 'offline', 'offset', 'onboard', 'operator',
  'optimize', 'optional', 'options', 'orchestrate', 'origin', 'output', 'overflow',
  'overhead', 'override',

  // P words
  'package', 'pagination', 'parallel', 'parameter', 'parent', 'parser', 'partial',
  'partition', 'pattern', 'payload', 'performance', 'permission', 'persist',
  'pipeline', 'placeholder', 'platform', 'plugin', 'pointer', 'policy', 'polling',
  'polymorphism', 'portal', 'predicate', 'prefix', 'preview', 'primitive', 'priority',
  'private', 'procedure', 'process', 'processor', 'producer', 'production', 'profile',
  'profiler', 'program', 'progress', 'project', 'promise', 'property', 'protocol',
  'prototype', 'provider', 'provisioner', 'proxy', 'public', 'publish', 'publisher',
  'pullrequest',

  // Q words
  'quality', 'query', 'queue', 'quickstart',

  // R words
  'rabbitmq', 'random', 'readme', 'realtime', 'rebuild', 'receiver', 'record',
  'recovery', 'recursion', 'recursive', 'redirect', 'reduce', 'reducer', 'redundant',
  'refactor', 'reference', 'reflection', 'refresh', 'register', 'registry', 'regression',
  'release', 'reload', 'remote', 'render', 'renderer', 'replace', 'replica',
  'replication', 'repository', 'request', 'require', 'reserved', 'reset', 'resolve',
  'resolver', 'resource', 'response', 'restapi', 'restore', 'restrict', 'result',
  'retry', 'return', 'reverse', 'review', 'revision', 'rollback', 'rollout',
  'rotation', 'router', 'routine', 'runtime',

  // S words
  'sample', 'sandbox', 'scaffold', 'scalable', 'scanner', 'schedule', 'scheduler',
  'schema', 'scope', 'screenshot', 'script', 'scrollbar', 'security', 'segment',
  'selector', 'semaphore', 'semantic', 'sentinel', 'sequence', 'serial', 'serialize',
  'serializer', 'server', 'service', 'session', 'setting', 'setup', 'sharding',
  'sidebar', 'signal', 'simulate', 'singleton', 'skeleton', 'snapshot', 'snippet',
  'socket', 'software', 'solution', 'source', 'specification', 'spreadsheet',
  'staging', 'standard', 'starter', 'statement', 'static', 'status', 'storage',
  'strategy', 'stream', 'string', 'struct', 'structure', 'stylesheet', 'subclass',
  'submodule', 'subscriber', 'subscription', 'suffix', 'supervisor', 'swagger',
  'switch', 'symbol', 'synchronize', 'syntax', 'system',

  // T words
  'table', 'target', 'task', 'teardown', 'telemetry', 'template', 'tenant',
  'terminal', 'testing', 'textfield', 'thread', 'throttle', 'throughput', 'timeout',
  'timestamp', 'toggle', 'token_type', 'toolkit', 'tooltip', 'tracker', 'transaction',
  'transform', 'transition', 'translate', 'transport', 'traverse', 'trigger',
  'truncate', 'tunnel', 'tutorial', 'typedef',

  // U words
  'undefined', 'unicode', 'unique', 'unittest', 'universal', 'unmanaged', 'unmarshal',
  'unsubscribe', 'upgrade', 'upstream', 'utility',

  // V words
  'validate', 'validator', 'variable', 'vendor', 'verbose', 'version', 'viewport',
  'virtual', 'visibility', 'visitor', 'visualize', 'volume',

  // W words
  'webhook', 'webmaster', 'webpack', 'websocket', 'widget', 'wildcard', 'window',
  'wizard', 'worker', 'workflow', 'workspace', 'wrapper',

  // X-Z words
  'xdebug', 'xmlparser', 'yield', 'zipfile',

  // Common placeholder / test values
  '000000', '111111', '123456', '1234567890', 'aaaaaa', 'abcdef', 'abcdefg',
  'changeme', 'deadbeef', 'default', 'develop', 'dummy', 'example', 'foobar',
  'insert_', 'my_api', 'mypassword', 'nopassword', 'notreal', 'password',
  'placeholder', 'please_change', 'redacted', 'removed', 'replace_me', 'sample',
  'secret_here', 'test1234', 'testkey', 'testpass', 'testsecret', 'testtoken',
  'todo', 'update_me', 'xxxxxx', 'your_api', 'your_key', 'your_secret',
  'your_token', 'yourkey', 'yoursecret', 'yourtoken',

  // Common non-secret file/format references
  'base64', 'binary', 'caption', 'charset', 'checksum', 'comment', 'content',
  'copyright', 'created', 'data', 'date', 'datetime', 'description', 'disabled',
  'empty', 'enabled', 'error', 'expired', 'false', 'filename', 'filepath',
  'format', 'generated', 'hostname', 'inactive', 'info', 'label', 'license',
  'message', 'modified', 'name', 'none', 'null', 'number', 'optional',
  'output', 'pending', 'prefix', 'preview', 'read', 'readme', 'required',
  'response', 'sample', 'staging', 'status', 'string', 'suffix', 'summary',
  'template', 'temporary', 'title', 'true', 'type', 'undefined', 'unknown',
  'updated', 'value', 'version', 'warning', 'write',

  // Common programming identifiers that appear in values
  'abstract', 'accessor', 'arguments', 'assert', 'boolean', 'break', 'case',
  'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete',
  'double', 'else', 'enum', 'export', 'extends', 'final', 'finally', 'float',
  'function', 'goto', 'implements', 'import', 'instanceof', 'integer', 'interface',
  'native', 'new', 'package', 'private', 'protected', 'public', 'return',
  'short', 'static', 'super', 'switch', 'synchronized', 'this', 'throw',
  'throws', 'transient', 'try', 'typeof', 'void', 'volatile', 'while',

  // Cloud/SaaS service names (appear in config, not secrets)
  'amazonaws', 'appengine', 'azurewebsites', 'cloudfront', 'googleapis', 'heroku',
  'microsoftonline', 'onmicrosoft', 'salesforce', 'servicebus', 'sharepoint',
]
