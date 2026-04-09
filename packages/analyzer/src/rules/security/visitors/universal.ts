/**
 * Security domain language-agnostic visitors.
 */

import type { CodeRuleVisitor } from '../../types.js'
import { makeViolation } from '../../types.js'
import { scanForSecrets, isSensitiveFile } from '../secret-scanner.js'

export const hardcodedSecretVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/hardcoded-secret',
  nodeTypes: ['string', 'template_string'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    // Strip string prefix (f, b, r, u for Python) and quotes
    const stripped = text.replace(/^[fFbBrRuU]*['"`]{1,3}|['"`]{1,3}$/g, '')
    if (stripped.length < 8) return null

    // Skip dict/object keys (only check values)
    const parent = node.parent
    if (parent?.type === 'pair' && parent.childForFieldName('key')?.id === node.id) {
      return null
    }

    // ── Pattern-based detection (222 patterns) ──────────────────────────
    const match = scanForSecrets(stripped)
    if (match) {
      return makeViolation(
        this.ruleKey, node, filePath, 'critical',
        `Hardcoded secret detected (${match.patternId})`,
        `This string matches a known secret pattern: ${match.description}. Use environment variables instead.`,
        sourceCode,
        'Move this secret to an environment variable.',
      )
    }

    // ── Variable-name fallback (for values that don't match any pattern) ──
    if (parent) {
      const varDeclarator = parent.type === 'variable_declarator' ? parent : null
      const assignment = parent.type === 'assignment_expression' || parent.type === 'assignment' ? parent : null
      const propAssignment = parent.type === 'pair' ? parent : null

      let nameNode = varDeclarator?.childForFieldName('name')
        || assignment?.childForFieldName('left')
        || propAssignment?.childForFieldName('key')

      if (nameNode) {
        const name = nameNode.text.toLowerCase()
        const secretNames = ['password', 'passwd', 'secret', 'apikey', 'api_key', 'token', 'auth_token', 'access_token', 'private_key']
        // Exclude variable names that are clearly not secrets (URIs, URLs, endpoints, types)
        const isNonSecretName = /(?:uri|url|endpoint|type|scope|name|header|grant|method)/.test(name)
        const isNonSecretValue =
          /https?:\/\//.test(stripped)                          // URLs
          || /^(true|false|null|undefined|localhost|None|True|False|Bearer)$/i.test(stripped) // literals & common tokens
          || /[[\]<>{}()#.=\s]/.test(stripped)                  // selectors, HTML, format strings, paths
        if (secretNames.some((s) => name.includes(s)) && stripped.length >= 8 && !isNonSecretName && !isNonSecretValue) {
          return makeViolation(
            this.ruleKey, node, filePath, 'critical',
            'Hardcoded secret detected',
            `Variable "${nameNode.text}" contains what appears to be a hardcoded secret. Use environment variables instead.`,
            sourceCode,
            'Move this secret to an environment variable.',
          )
        }
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// hardcoded-ip
// ---------------------------------------------------------------------------

const IPV4_REGEX = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/
const EXCLUDED_IPS = new Set(['127.0.0.1', '0.0.0.0', '255.255.255.255'])

export const hardcodedIpVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/hardcoded-ip',
  nodeTypes: ['string', 'template_string'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    const stripped = text.replace(/^[fFbBrRuU]*['"`]{1,3}|['"`]{1,3}$/g, '')

    const match = IPV4_REGEX.exec(stripped)
    if (!match) return null

    const ip = match[1]
    if (EXCLUDED_IPS.has(ip)) return null

    // Skip version-like numbers in User-Agent strings, semver, etc.
    if (/Mozilla|Chrome|Safari|Firefox|AppleWebKit|Gecko/i.test(stripped)) return null

    // Validate each octet is 0-255
    const octets = ip.split('.')
    if (octets.some((o) => parseInt(o, 10) > 255)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Hardcoded IP address',
      `Hardcoded IP address "${ip}" found. Use configuration or DNS names instead.`,
      sourceCode,
      'Move IP addresses to configuration files or environment variables.',
    )
  },
}

// ---------------------------------------------------------------------------
// clear-text-protocol
// ---------------------------------------------------------------------------

const CLEARTEXT_PROTOCOLS = ['http://', 'ftp://', 'telnet://']
const LOCALHOST_PREFIXES = ['http://localhost', 'http://127.0.0.1', 'http://0.0.0.0']

export const clearTextProtocolVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/clear-text-protocol',
  nodeTypes: ['string', 'template_string'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    const stripped = text.replace(/^[fFbBrRuU]*['"`]{1,3}|['"`]{1,3}$/g, '')
    const lower = stripped.toLowerCase()

    for (const protocol of CLEARTEXT_PROTOCOLS) {
      if (lower.startsWith(protocol)) {
        // Exclude localhost/loopback for local development
        if (LOCALHOST_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
          return null
        }
        // Exclude well-known namespace URIs (SVG xmlns, W3C, schema.org, etc.)
        if (/w3\.org|schema\.org|xmlns|openxmlformats|xmlsoap|purl\.org/.test(lower)) {
          return null
        }
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Clear-text protocol',
          `Use of unencrypted protocol "${protocol}" detected. Data may be intercepted in transit.`,
          sourceCode,
          'Use encrypted protocols (https://, sftp://, ssh://) instead.',
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// hardcoded-blockchain-mnemonic
// ---------------------------------------------------------------------------

// BIP39 common words that appear in seed phrases - we look for 12+ word sequences
const BIP39_COMMON_WORDS = new Set([
  'abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract', 'absurd', 'abuse',
  'access', 'accident', 'account', 'accuse', 'achieve', 'acid', 'acoustic', 'acquire', 'across', 'act',
  'action', 'actor', 'actress', 'actual', 'adapt', 'add', 'addict', 'address', 'adjust', 'admit',
  'adult', 'advance', 'advice', 'aerobic', 'affair', 'afford', 'afraid', 'again', 'age', 'agent',
  'agree', 'ahead', 'aim', 'air', 'airport', 'aisle', 'alarm', 'album', 'alcohol', 'alert',
  'alien', 'all', 'alley', 'allow', 'almost', 'alone', 'alpha', 'already', 'also', 'alter',
  'always', 'amateur', 'amazing', 'among', 'amount', 'amused', 'analyst', 'anchor', 'ancient', 'anger',
  'angle', 'angry', 'animal', 'ankle', 'announce', 'annual', 'another', 'answer', 'antenna', 'antique',
  'anxiety', 'any', 'apart', 'apology', 'appear', 'apple', 'approve', 'april', 'arch', 'arctic',
  'area', 'arena', 'argue', 'arm', 'armed', 'armor', 'army', 'arrange', 'arrest', 'arrive',
  'arrow', 'art', 'artefact', 'artist', 'artwork', 'ask', 'aspect', 'assault', 'asset', 'assist',
  'assume', 'asthma', 'athlete', 'atom', 'attack', 'attend', 'attitude', 'attract', 'auction', 'audit',
  'august', 'aunt', 'author', 'auto', 'autumn', 'average', 'avocado', 'avoid', 'awake', 'aware',
  'basket', 'battle', 'beach', 'beauty', 'because', 'become', 'before', 'begin', 'behind', 'believe',
  'below', 'bench', 'benefit', 'best', 'betray', 'better', 'between', 'beyond', 'bicycle', 'bid',
  'blanket', 'blast', 'bleak', 'bless', 'blind', 'blood', 'blossom', 'blue', 'blur', 'board',
  'boat', 'body', 'bomb', 'bone', 'bonus', 'book', 'boost', 'border', 'boring', 'borrow',
  'boss', 'bottom', 'bounce', 'box', 'boy', 'bracket', 'brain', 'brand', 'brass', 'brave',
  'bread', 'breeze', 'brick', 'bridge', 'brief', 'bright', 'bring', 'brisk', 'broken', 'brother',
  'brown', 'brush', 'bubble', 'buddy', 'budget', 'buffalo', 'build', 'bulb', 'bulk', 'bullet',
  'burden', 'burger', 'burst', 'bus', 'business', 'busy', 'butter', 'buyer', 'buzz', 'cabbage',
  'cabin', 'cable', 'cactus', 'cage', 'cake', 'call', 'calm', 'camera', 'camp', 'can',
  'canal', 'cancel', 'candy', 'cannon', 'canoe', 'canvas', 'canyon', 'capable', 'capital', 'captain',
  'carbon', 'card', 'cargo', 'carpet', 'carry', 'cart', 'case', 'cash', 'casino', 'castle',
  'catalog', 'catch', 'category', 'cattle', 'caught', 'cause', 'caution', 'cave', 'ceiling', 'celery',
  'cement', 'census', 'century', 'cereal', 'certain', 'chair', 'chalk', 'champion', 'change', 'chaos',
  'chapter', 'charge', 'chase', 'cheap', 'check', 'cheese', 'cherry', 'chest', 'chicken', 'chief',
  'child', 'chimney', 'choice', 'choose', 'chronic', 'chunk', 'churn', 'citizen', 'city', 'civil',
  'claim', 'clap', 'clarify', 'claw', 'clay', 'clean', 'clerk', 'clever', 'cliff', 'climb',
  'decorate', 'decrease', 'deer', 'defense', 'define', 'defy', 'degree', 'delay', 'deliver', 'demand',
  'destroy', 'detail', 'detect', 'develop', 'device', 'devote', 'diagram', 'dial', 'diamond', 'diary',
  'differ', 'digital', 'dignity', 'dilemma', 'dinner', 'dinosaur', 'direct', 'dirt', 'disagree', 'discover',
  'disease', 'dish', 'dismiss', 'disorder', 'display', 'distance', 'divert', 'divide', 'dizzy', 'doctor',
  'electric', 'elegant', 'element', 'elephant', 'elevator', 'elite', 'else', 'embark', 'embody', 'embrace',
  'emerge', 'emotion', 'employ', 'empower', 'empty', 'enable', 'enact', 'enforce', 'engage', 'engine',
  'enhance', 'enjoy', 'enlist', 'enough', 'enrich', 'enroll', 'ensure', 'enter', 'entire', 'entry',
  'fabric', 'face', 'faculty', 'fade', 'faint', 'faith', 'fall', 'false', 'fame', 'family',
  'fantasy', 'fashion', 'fatal', 'father', 'fatigue', 'fault', 'favorite', 'feature', 'february', 'federal',
  'fire', 'firm', 'fiscal', 'fish', 'flag', 'flame', 'flash', 'flat', 'flavor', 'flee',
  'garden', 'garlic', 'garment', 'gas', 'gasp', 'gate', 'gather', 'gauge', 'gaze', 'general',
  'genius', 'genre', 'gentle', 'genuine', 'gesture', 'ghost', 'giant', 'gift', 'giggle', 'ginger',
  'giraffe', 'girl', 'give', 'glad', 'glance', 'glare', 'glass', 'glide', 'glimpse', 'globe',
  'gloom', 'glory', 'glove', 'glow', 'glue', 'goat', 'goddess', 'gold', 'good', 'goose',
  'gorilla', 'gospel', 'gossip', 'govern', 'gown', 'grab', 'grace', 'grain', 'grant', 'grape',
  'harvest', 'hat', 'have', 'hawk', 'hazard', 'head', 'health', 'heart', 'heavy', 'hedgehog',
  'height', 'hello', 'helmet', 'help', 'hen', 'hero', 'hip', 'hire', 'history', 'hobby',
  'hockey', 'hold', 'hole', 'holiday', 'hollow', 'home', 'honey', 'hood', 'hope', 'horn',
  'horror', 'horse', 'hospital', 'host', 'hotel', 'hour', 'hover', 'hub', 'huge', 'human',
  'hungry', 'hunt', 'hurdle', 'hurry', 'hurt', 'husband', 'hybrid', 'ice', 'icon', 'idea',
  'identify', 'idle', 'ignore', 'ill', 'illegal', 'illness', 'image', 'imitate', 'immense', 'immune',
  'impact', 'impose', 'improve', 'impulse', 'inch', 'include', 'income', 'increase', 'index', 'indicate',
  'indoor', 'industry', 'infant', 'inflict', 'inform', 'initial', 'inject', 'inmate', 'inner', 'innocent',
  'input', 'inquiry', 'insane', 'insect', 'inside', 'inspire', 'install', 'intact', 'interest', 'into',
  'invest', 'invite', 'involve', 'iron', 'island', 'isolate', 'issue', 'item', 'ivory', 'jacket',
  'jaguar', 'jar', 'jazz', 'jealous', 'jeans', 'jelly', 'jewel', 'job', 'join', 'joke',
  'journey', 'joy', 'judge', 'juice', 'jungle', 'junior', 'junk', 'kangaroo', 'keen', 'keep',
  'ketchup', 'key', 'kick', 'kid', 'kidney', 'kind', 'kingdom', 'kiss', 'kit', 'kitchen',
  'kite', 'kitten', 'kiwi', 'knee', 'knife', 'knock', 'know', 'lab', 'label', 'labor',
  'ladder', 'lady', 'lake', 'lamp', 'language', 'laptop', 'large', 'later', 'latin', 'laugh',
  'laundry', 'lava', 'lawn', 'lawsuit', 'layer', 'lazy', 'leader', 'leaf', 'learn', 'leave',
  'lecture', 'left', 'leg', 'legal', 'legend', 'leisure', 'lemon', 'lend', 'length', 'lens',
  'leopard', 'lesson', 'letter', 'level', 'liberty', 'library', 'license', 'life', 'lift', 'light',
  'like', 'limb', 'limit', 'link', 'lion', 'liquid', 'list', 'little', 'live', 'lizard',
  'load', 'loan', 'lobster', 'local', 'lock', 'logic', 'lonely', 'long', 'loop', 'lottery',
  'mango', 'mansion', 'manual', 'maple', 'marble', 'march', 'margin', 'marine', 'market', 'marriage',
  'narrow', 'nasty', 'nation', 'nature', 'near', 'neck', 'need', 'negative', 'neglect', 'neither',
  'nephew', 'nerve', 'nest', 'net', 'network', 'neutral', 'never', 'news', 'next', 'nice',
  'ocean', 'october', 'odor', 'off', 'offer', 'office', 'often', 'oil', 'okay', 'old',
  'olive', 'olympic', 'omit', 'once', 'one', 'onion', 'online', 'only', 'open', 'opera',
  'opinion', 'oppose', 'option', 'orange', 'orbit', 'orchard', 'order', 'ordinary', 'organ', 'orient',
  'original', 'orphan', 'ostrich', 'other', 'outdoor', 'outer', 'output', 'outside', 'oval', 'oven',
  'pilot', 'pink', 'pioneer', 'pipe', 'pistol', 'pitch', 'pizza', 'place', 'planet', 'plastic',
  'plate', 'play', 'please', 'pledge', 'pluck', 'plug', 'plunge', 'poem', 'poet', 'point',
  'polar', 'pole', 'police', 'pond', 'pony', 'pool', 'popular', 'portion', 'position', 'possible',
  'quality', 'quantum', 'quarter', 'question', 'quick', 'quit', 'quiz', 'quote', 'rabbit', 'raccoon',
  'race', 'rack', 'radar', 'radio', 'rail', 'rain', 'raise', 'rally', 'ramp', 'ranch',
  'random', 'range', 'rapid', 'rare', 'rate', 'rather', 'raven', 'raw', 'razor', 'ready',
  'real', 'reason', 'rebel', 'rebuild', 'recall', 'receive', 'recipe', 'record', 'recycle', 'reduce',
  'skull', 'slab', 'slam', 'sleep', 'slender', 'slice', 'slide', 'slight', 'slim', 'slogan',
  'slot', 'slow', 'slush', 'small', 'smart', 'smile', 'smoke', 'smooth', 'snack', 'snake',
  'snap', 'sniff', 'snow', 'soap', 'soccer', 'social', 'sock', 'soda', 'soft', 'solar',
  'transfer', 'trap', 'trash', 'travel', 'tray', 'treat', 'tree', 'trend', 'trial', 'tribe',
  'trick', 'trigger', 'trim', 'trip', 'trophy', 'trouble', 'truck', 'truly', 'trumpet', 'trust',
  'vacuum', 'valid', 'valley', 'valve', 'van', 'vanish', 'vapor', 'various', 'vast', 'vault',
  'vehicle', 'velvet', 'vendor', 'venture', 'venue', 'verb', 'verify', 'version', 'very', 'vessel',
  'wage', 'wagon', 'wait', 'walk', 'wall', 'walnut', 'want', 'warfare', 'warm', 'warrior',
  'wash', 'wasp', 'waste', 'water', 'wave', 'way', 'wealth', 'weapon', 'wear', 'weasel',
  'weather', 'web', 'wedding', 'weekend', 'weird', 'welcome', 'west', 'wet', 'whale', 'what',
  'wheat', 'wheel', 'when', 'where', 'whip', 'whisper', 'wide', 'width', 'wife', 'wild',
  'will', 'win', 'window', 'wine', 'wing', 'wink', 'winner', 'winter', 'wire', 'wisdom',
  'wise', 'wish', 'witness', 'wolf', 'woman', 'wonder', 'wood', 'wool', 'word', 'work',
  'world', 'worry', 'worth', 'wrap', 'wreck', 'wrestle', 'wrist', 'write', 'wrong', 'yard',
  'year', 'yellow', 'you', 'young', 'youth', 'zebra', 'zero', 'zone', 'zoo',
])

export const hardcodedBlockchainMnemonicVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/hardcoded-blockchain-mnemonic',
  nodeTypes: ['string', 'template_string'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    const stripped = text.replace(/^[fFbBrRuU]*['"`]{1,3}|['"`]{1,3}$/g, '')

    const words = stripped.trim().split(/\s+/)
    // BIP39 mnemonics are 12 or 24 words
    if (words.length !== 12 && words.length !== 24) return null

    const bip39Count = words.filter((w) => BIP39_COMMON_WORDS.has(w.toLowerCase())).length
    // Require at least 80% of words to be BIP39 words
    if (bip39Count / words.length >= 0.8) {
      return makeViolation(
        this.ruleKey, node, filePath, 'critical',
        'Hardcoded blockchain mnemonic',
        'This string appears to be a BIP39 mnemonic seed phrase. Hardcoded mnemonics compromise wallet security.',
        sourceCode,
        'Never hardcode mnemonic phrases. Store them securely in a hardware wallet or encrypted vault.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// hardcoded-database-password
// ---------------------------------------------------------------------------

const DB_CONNECTION_PATTERNS = [
  /(?:mysql|postgresql|postgres|mongodb|sqlite|mssql|oracle):\/\/[^:]+:([^@]+)@/i,
  /password\s*=\s*['"][^'"]{4,}['"]/i,
  /pwd\s*=\s*['"][^'"]{4,}['"]/i,
]

export const hardcodedDatabasePasswordVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/hardcoded-database-password',
  nodeTypes: ['string', 'template_string'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    const stripped = text.replace(/^[fFbBrRuU]*['"`]{1,3}|['"`]{1,3}$/g, '')

    for (const pattern of DB_CONNECTION_PATTERNS) {
      if (pattern.test(stripped)) {
        // Exclude placeholders and env-var references
        if (/\$\{|%s|<password>|\$\(|process\.env/i.test(stripped)) return null
        return makeViolation(
          this.ruleKey, node, filePath, 'critical',
          'Hardcoded database password',
          'Database connection string contains a hardcoded password.',
          sourceCode,
          'Load database credentials from environment variables.',
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// ldap-unauthenticated
// ---------------------------------------------------------------------------

export const ldapUnauthenticatedVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/ldap-unauthenticated',
  nodeTypes: ['string', 'template_string'],
  visit(node, filePath, sourceCode) {
    // LDAP anonymous bind DSN: ldap://host or ldaps://host without credentials
    const text = node.text
    const stripped = text.replace(/^[fFbBrRuU]*['"`]{1,3}|['"`]{1,3}$/g, '')

    const lower = stripped.toLowerCase()
    if (!lower.startsWith('ldap://') && !lower.startsWith('ldaps://')) return null

    // If there are no credentials (no user:pass@), it's an anonymous bind
    if (!/@/.test(stripped)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unauthenticated LDAP bind',
        'LDAP connection without credentials enables anonymous bind, which may grant unintended access.',
        sourceCode,
        'Provide authentication credentials in the LDAP bind call.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// password-stored-plaintext
// ---------------------------------------------------------------------------

export const passwordStoredPlaintextVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/password-stored-plaintext',
  nodeTypes: ['pair', 'assignment_expression', 'assignment'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'pair' || node.type === 'assignment_expression' || node.type === 'assignment') {
      const key = node.childForFieldName('key') ?? node.childForFieldName('left')
      const value = node.childForFieldName('value') ?? node.childForFieldName('right')

      if (!key || !value) return null

      const keyText = key.text.toLowerCase().replace(/['"]/g, '')
      if (keyText !== 'password' && keyText !== 'passwd' && keyText !== 'pwd') return null

      // Flag if value is directly from request body or a plain identifier (not a hash function call)
      const valueText = value.text.toLowerCase()
      if (valueText.includes('req.body') || valueText.includes('request.form') ||
          valueText.includes('request.data')) {
        // Value is raw request input — check it's not going through a hash function
        if (!valueText.includes('hash') && !valueText.includes('bcrypt') &&
            !valueText.includes('argon') && !valueText.includes('scrypt') &&
            !valueText.includes('pbkdf')) {
          return makeViolation(
            this.ruleKey, node, filePath, 'critical',
            'Password stored in plaintext',
            `Password field assigned directly from user input without hashing.`,
            sourceCode,
            'Hash passwords using bcrypt, argon2, or scrypt before storing.',
          )
        }
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// unpredictable-salt-missing
// ---------------------------------------------------------------------------

const HASH_FUNCTIONS_NEEDING_SALT = new Set([
  'createHash', 'md5', 'sha1', 'sha256', 'sha512',
])

export const unpredictableSaltMissingVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unpredictable-salt-missing',
  nodeTypes: ['call_expression', 'call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'member_expression' || fn.type === 'attribute') {
      const prop = fn.childForFieldName('property') ?? fn.childForFieldName('attribute')
      if (prop) methodName = prop.text
    } else if (fn.type === 'identifier') {
      methodName = fn.text
    }

    if (!HASH_FUNCTIONS_NEEDING_SALT.has(methodName)) return null

    // Only flag if this is in a password-hashing context
    let parent = node.parent
    while (parent) {
      const parentText = parent.text.toLowerCase()
      if (parentText.includes('password') || parentText.includes('passwd')) {
        const args = node.childForFieldName('arguments')
        if (args && args.namedChildren.length < 2) {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Missing salt in hash',
            `${methodName}() called without a salt in a password context. This allows rainbow table attacks.`,
            sourceCode,
            'Use a password hashing function like bcrypt, argon2, or PBKDF2 which handle salting automatically.',
          )
        }
        return null
      }
      if (parent.type === 'function_declaration' || parent.type === 'function_definition' ||
          parent.type === 'method_definition' || parent.type === 'program') break
      parent = parent.parent
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// sensitive-file (path-only rule) — Gap 1
// ---------------------------------------------------------------------------

export const sensitiveFileVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/hardcoded-secret',
  nodeTypes: ['program', 'module'],
  visit(node, filePath, sourceCode) {
    const result = isSensitiveFile(filePath)
    if (result?.isSensitive) {
      return makeViolation(
        this.ruleKey, node, filePath, 'critical',
        'Sensitive file detected',
        result.description + ' Ensure this file is not committed to source control.',
        sourceCode,
        'Add this file to .gitignore and move secrets to a vault or environment variables.',
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// hardcoded-secret-in-comment — Gap 3
// ---------------------------------------------------------------------------

/**
 * Strip comment markers from a comment node's text.
 */
function stripCommentMarkers(text: string): string {
  return text
    .replace(/^\/\/\s?/, '')        // single-line JS/TS
    .replace(/^\/\*\s?/, '')        // block comment start
    .replace(/\s?\*\/$/, '')        // block comment end
    .replace(/^\s*\*\s?/gm, '')    // middle lines of block comment
    .replace(/^#\s?/gm, '')        // Python / shell comments
    .trim()
}

export const hardcodedSecretInCommentVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/hardcoded-secret',
  nodeTypes: ['comment'],
  visit(node, filePath, sourceCode) {
    const raw = node.text
    const stripped = stripCommentMarkers(raw)
    if (stripped.length < 8) return null

    // Scan the whole stripped comment text
    const match = scanForSecrets(stripped)
    if (match) {
      return makeViolation(
        this.ruleKey, node, filePath, 'critical',
        `Hardcoded secret detected in comment (${match.patternId})`,
        `A comment contains a value matching a known secret pattern: ${match.description}. Remove the secret from source code.`,
        sourceCode,
        'Remove the secret from this comment and rotate the credential.',
      )
    }

    // Also scan line-by-line for multi-line block comments
    const lines = stripped.split('\n')
    if (lines.length > 1) {
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.length < 8) continue
        const lineMatch = scanForSecrets(trimmed)
        if (lineMatch) {
          return makeViolation(
            this.ruleKey, node, filePath, 'critical',
            `Hardcoded secret detected in comment (${lineMatch.patternId})`,
            `A comment contains a value matching a known secret pattern: ${lineMatch.description}. Remove the secret from source code.`,
            sourceCode,
            'Remove the secret from this comment and rotate the credential.',
          )
        }
      }
    }

    return null
  },
}

export const SECURITY_UNIVERSAL_VISITORS: CodeRuleVisitor[] = [
  sensitiveFileVisitor,
  hardcodedSecretVisitor,
  hardcodedSecretInCommentVisitor,
  hardcodedIpVisitor,
  clearTextProtocolVisitor,
  hardcodedBlockchainMnemonicVisitor,
  hardcodedDatabasePasswordVisitor,
  ldapUnauthenticatedVisitor,
  passwordStoredPlaintextVisitor,
  unpredictableSaltMissingVisitor,
]
