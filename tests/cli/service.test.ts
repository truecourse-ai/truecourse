import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// Test config utilities
import {
  readConfig,
  writeConfig,
  getConfigPath,
  type TrueCourseConfig,
} from '../../tools/cli/src/commands/helpers'

// Test env parsing
import { parseEnvFile } from '../../tools/cli/src/commands/service/env'

// Test log rotation
import {
  rotateLogs,
  rotateErrorLogs,
  getLogDir,
  getLogPath,
} from '../../tools/cli/src/commands/service/logs'

// Test platform factory
import { getPlatform, type ServicePlatform } from '../../tools/cli/src/commands/service/platform'

// Use a temp directory for all filesystem tests
let tmpDir: string

function setupTmpDir() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'truecourse-test-'))
}

function cleanupTmpDir() {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

describe('Config utilities', () => {
  const originalHome = process.env.HOME

  beforeEach(() => {
    setupTmpDir()
    process.env.HOME = tmpDir
  })

  afterEach(() => {
    process.env.HOME = originalHome
    cleanupTmpDir()
  })

  it('readConfig returns defaults when no config file exists', () => {
    const config = readConfig()
    expect(config).toEqual({ runMode: 'console' })
  })

  it('writeConfig creates config file and readConfig reads it back', () => {
    writeConfig({ runMode: 'service' })
    const config = readConfig()
    expect(config.runMode).toBe('service')
  })

  it('writeConfig merges with existing config', () => {
    writeConfig({ runMode: 'service' })
    writeConfig({ runMode: 'console' })
    const config = readConfig()
    expect(config.runMode).toBe('console')
  })

  it('getConfigPath points to ~/.truecourse/config.json', () => {
    const configPath = getConfigPath()
    expect(configPath).toBe(path.join(tmpDir, '.truecourse', 'config.json'))
  })

  it('writeConfig creates intermediate directories', () => {
    const configPath = getConfigPath()
    expect(fs.existsSync(path.dirname(configPath))).toBe(false)
    writeConfig({ runMode: 'service' })
    expect(fs.existsSync(configPath)).toBe(true)
  })

  it('readConfig handles corrupted JSON gracefully', () => {
    const configPath = getConfigPath()
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, 'not json{{{', 'utf-8')
    const config = readConfig()
    expect(config).toEqual({ runMode: 'console' })
  })
})

describe('parseEnvFile', () => {
  beforeEach(setupTmpDir)
  afterEach(cleanupTmpDir)

  it('returns empty object for nonexistent file', () => {
    const result = parseEnvFile(path.join(tmpDir, 'nonexistent'))
    expect(result).toEqual({})
  })

  it('parses simple key=value pairs', () => {
    const envPath = path.join(tmpDir, '.env')
    fs.writeFileSync(envPath, 'FOO=bar\nBAZ=qux\n')
    const result = parseEnvFile(envPath)
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' })
  })

  it('skips comments and empty lines', () => {
    const envPath = path.join(tmpDir, '.env')
    fs.writeFileSync(envPath, '# comment\n\nFOO=bar\n# another comment\n')
    const result = parseEnvFile(envPath)
    expect(result).toEqual({ FOO: 'bar' })
  })

  it('strips surrounding quotes from values', () => {
    const envPath = path.join(tmpDir, '.env')
    fs.writeFileSync(envPath, 'A="double quoted"\nB=\'single quoted\'\nC=unquoted\n')
    const result = parseEnvFile(envPath)
    expect(result).toEqual({
      A: 'double quoted',
      B: 'single quoted',
      C: 'unquoted',
    })
  })

  it('handles values with equals signs', () => {
    const envPath = path.join(tmpDir, '.env')
    fs.writeFileSync(envPath, 'DATABASE_URL=postgres://user:pass@host/db?opt=val\n')
    const result = parseEnvFile(envPath)
    expect(result.DATABASE_URL).toBe('postgres://user:pass@host/db?opt=val')
  })

  it('skips lines without equals sign', () => {
    const envPath = path.join(tmpDir, '.env')
    fs.writeFileSync(envPath, 'VALID=yes\ninvalid_line\nALSO_VALID=ok\n')
    const result = parseEnvFile(envPath)
    expect(result).toEqual({ VALID: 'yes', ALSO_VALID: 'ok' })
  })
})

describe('Log rotation', () => {
  let logDir: string

  beforeEach(() => {
    setupTmpDir()
    logDir = path.join(tmpDir, 'logs')
    fs.mkdirSync(logDir, { recursive: true })
  })

  afterEach(cleanupTmpDir)

  it('does nothing when log file does not exist', () => {
    rotateLogs(logDir)
    // Should not throw
    expect(fs.readdirSync(logDir)).toHaveLength(0)
  })

  it('does nothing when log file is under 10MB', () => {
    const logFile = path.join(logDir, 'truecourse.log')
    fs.writeFileSync(logFile, 'small content')
    rotateLogs(logDir)
    expect(fs.existsSync(logFile)).toBe(true)
    expect(fs.existsSync(path.join(logDir, 'truecourse.log.1'))).toBe(false)
  })

  it('rotates when log file exceeds 10MB', () => {
    const logFile = path.join(logDir, 'truecourse.log')
    // Create a file just over 10MB
    const buf = Buffer.alloc(10 * 1024 * 1024 + 1, 'x')
    fs.writeFileSync(logFile, buf)

    rotateLogs(logDir)

    expect(fs.existsSync(logFile)).toBe(false)
    expect(fs.existsSync(path.join(logDir, 'truecourse.log.1'))).toBe(true)
  })

  it('shifts existing rotated files', () => {
    const logFile = path.join(logDir, 'truecourse.log')
    const buf = Buffer.alloc(10 * 1024 * 1024 + 1, 'x')

    // Create existing rotated files
    fs.writeFileSync(path.join(logDir, 'truecourse.log.1'), 'old-1')
    fs.writeFileSync(path.join(logDir, 'truecourse.log.2'), 'old-2')
    fs.writeFileSync(logFile, buf)

    rotateLogs(logDir)

    expect(fs.readFileSync(path.join(logDir, 'truecourse.log.2'), 'utf-8')).toBe('old-1')
    expect(fs.readFileSync(path.join(logDir, 'truecourse.log.3'), 'utf-8')).toBe('old-2')
    expect(fs.existsSync(path.join(logDir, 'truecourse.log.1'))).toBe(true)
  })

  it('deletes the oldest file when max rotation count reached', () => {
    const logFile = path.join(logDir, 'truecourse.log')
    const buf = Buffer.alloc(10 * 1024 * 1024 + 1, 'x')

    // Create max rotated files (1 through 5)
    for (let i = 1; i <= 5; i++) {
      fs.writeFileSync(path.join(logDir, `truecourse.log.${i}`), `old-${i}`)
    }
    fs.writeFileSync(logFile, buf)

    rotateLogs(logDir)

    // .5 should now contain what was .4 (old-4), the original .5 (old-5) is deleted
    expect(fs.readFileSync(path.join(logDir, 'truecourse.log.5'), 'utf-8')).toBe('old-4')
    // .1 should be the rotated current file
    expect(fs.existsSync(path.join(logDir, 'truecourse.log.1'))).toBe(true)
    expect(fs.statSync(path.join(logDir, 'truecourse.log.1')).size).toBeGreaterThan(10 * 1024 * 1024)
  })

  it('rotateErrorLogs works the same way for error log', () => {
    const logFile = path.join(logDir, 'truecourse.error.log')
    const buf = Buffer.alloc(10 * 1024 * 1024 + 1, 'x')
    fs.writeFileSync(logFile, buf)

    rotateErrorLogs(logDir)

    expect(fs.existsSync(logFile)).toBe(false)
    expect(fs.existsSync(path.join(logDir, 'truecourse.error.log.1'))).toBe(true)
  })
})

describe('getLogDir / getLogPath', () => {
  it('getLogDir returns ~/.truecourse/logs', () => {
    expect(getLogDir()).toBe(path.join(os.homedir(), '.truecourse', 'logs'))
  })

  it('getLogPath returns ~/.truecourse/logs/truecourse.log', () => {
    expect(getLogPath()).toBe(path.join(os.homedir(), '.truecourse', 'logs', 'truecourse.log'))
  })
})

describe('getPlatform', () => {
  it('returns a platform with the expected interface', () => {
    const platform = getPlatform()
    expect(typeof platform.install).toBe('function')
    expect(typeof platform.uninstall).toBe('function')
    expect(typeof platform.start).toBe('function')
    expect(typeof platform.stop).toBe('function')
    expect(typeof platform.status).toBe('function')
    expect(typeof platform.isInstalled).toBe('function')
  })

  it('returns MacOSService on darwin', () => {
    // We're running on macOS based on the environment
    if (process.platform === 'darwin') {
      const platform = getPlatform()
      expect(platform.constructor.name).toBe('MacOSService')
    }
  })
})
