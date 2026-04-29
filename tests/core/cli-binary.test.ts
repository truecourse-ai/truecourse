import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We mock node:child_process for the helper, then import dynamically inside
// each test so the mock is in place before the module under test resolves
// the binding.
vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

describe('isCliBinaryAvailable', () => {
  let spawnSyncMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const cp = await import('node:child_process');
    spawnSyncMock = cp.spawnSync as unknown as ReturnType<typeof vi.fn>;
    spawnSyncMock.mockReset();
  });

  it('returns true when --version exits 0', async () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: '', stderr: '', signal: null, pid: 1, output: [] });
    const { isCliBinaryAvailable } = await import('../../packages/core/src/lib/cli-binary.js');
    expect(isCliBinaryAvailable('claude')).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      'claude',
      ['--version'],
      expect.objectContaining({ stdio: 'ignore' }),
    );
  });

  it('returns false when binary is missing (non-zero status)', async () => {
    spawnSyncMock.mockReturnValue({ status: null, stdout: '', stderr: '', signal: null, pid: 0, output: [], error: new Error('ENOENT') });
    const { isCliBinaryAvailable } = await import('../../packages/core/src/lib/cli-binary.js');
    expect(isCliBinaryAvailable('claude')).toBe(false);
  });

  it('uses shell:true on Windows so .cmd shims resolve', async () => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      spawnSyncMock.mockReturnValue({ status: 0, stdout: '', stderr: '', signal: null, pid: 1, output: [] });
      const { isCliBinaryAvailable } = await import('../../packages/core/src/lib/cli-binary.js');
      isCliBinaryAvailable('claude.cmd');
      expect(spawnSyncMock).toHaveBeenCalledWith(
        'claude.cmd',
        ['--version'],
        expect.objectContaining({ shell: true }),
      );
    } finally {
      Object.defineProperty(process, 'platform', original);
    }
  });

  it('does not use shell on POSIX', async () => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    try {
      spawnSyncMock.mockReturnValue({ status: 0, stdout: '', stderr: '', signal: null, pid: 1, output: [] });
      const { isCliBinaryAvailable } = await import('../../packages/core/src/lib/cli-binary.js');
      isCliBinaryAvailable('claude');
      expect(spawnSyncMock).toHaveBeenCalledWith(
        'claude',
        ['--version'],
        expect.objectContaining({ shell: false }),
      );
    } finally {
      Object.defineProperty(process, 'platform', original);
    }
  });
});
