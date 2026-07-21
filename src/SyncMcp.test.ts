import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { detectPackageSpecifier, register } from './SyncMcp.js'

const addMcp = vi.hoisted(() => ({
  registry: {
    'claude-code': { displayName: 'Claude Code' },
    'claude-desktop': { displayName: 'Claude Desktop' },
    cursor: { displayName: 'Cursor' },
    codex: { displayName: 'Codex' },
  } as Record<string, { displayName: string }>,
  detectedGlobal: [] as string[],
  detectedProject: [] as string[],
  upserts: [] as Array<{ agent: string; name: string; config: unknown; options: unknown }>,
  failFor: new Set<string>(),
}))

vi.mock('add-mcp', () => ({
  agents: addMcp.registry,
  getAgentTypes: () => Object.keys(addMcp.registry),
  detectGlobalAgents: async () => addMcp.detectedGlobal,
  detectProjectAgents: () => addMcp.detectedProject,
  upsertServer: (agent: string, name: string, config: unknown, options: unknown) => {
    addMcp.upserts.push({ agent, name, config, options })
    return { success: !addMcp.failFor.has(agent), path: '' }
  },
}))

let fakeHome: string | undefined
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return {
    ...actual,
    homedir: () => fakeHome ?? actual.homedir(),
  }
})

let tmp: string

beforeEach(() => {
  const savedArgv1 = process.argv[1]
  tmp = join(tmpdir(), `clac-test-${Date.now()}`)
  mkdirSync(join(tmp, 'node_modules', '.bin'), { recursive: true })
  fakeHome = join(tmp, 'home')
  mkdirSync(fakeHome, { recursive: true })
  return () => {
    process.argv[1] = savedArgv1!
    fakeHome = undefined
    rmSync(tmp, { recursive: true, force: true })
  }
})

function setupPkg(deps: Record<string, string>) {
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ dependencies: deps }))
  process.argv[1] = join(tmp, 'node_modules', '.bin', 'my-cli')
}

// --- detectPackageSpecifier tests ---

test('returns bare name when argv[1] is undefined', () => {
  process.argv[1] = undefined as any
  expect(detectPackageSpecifier('my-cli')).toBe('my-cli')
})

test('returns bare name when no node_modules in path', () => {
  process.argv[1] = '/usr/local/bin/my-cli'
  expect(detectPackageSpecifier('my-cli')).toBe('my-cli')
})

test('returns bare name when package.json is missing', () => {
  process.argv[1] = join(tmp, 'node_modules', '.bin', 'my-cli')
  expect(detectPackageSpecifier('my-cli')).toBe('my-cli')
})

test('returns bare name when dep is not found', () => {
  setupPkg({ other: '1.0.0' })
  expect(detectPackageSpecifier('my-cli')).toBe('my-cli')
})

test('returns bare name when multiple deps exist', () => {
  setupPkg({ 'my-cli': '1.0.0', other: '2.0.0' })
  expect(detectPackageSpecifier('my-cli')).toBe('my-cli')
})

test('returns URL specifier for https dep', () => {
  setupPkg({ 'my-cli': 'https://pkg.pr.new/my-cli@abc123' })
  expect(detectPackageSpecifier('my-cli')).toBe('https://pkg.pr.new/my-cli@abc123')
})

test('returns URL specifier for file: dep', () => {
  setupPkg({ 'my-cli': 'file:../local-cli' })
  expect(detectPackageSpecifier('my-cli')).toBe('file:../local-cli')
})

test('returns name@version for pinned version', () => {
  setupPkg({ 'my-cli': '1.2.3' })
  expect(detectPackageSpecifier('my-cli')).toBe('my-cli@1.2.3')
})

test('returns bare name for range specifier', () => {
  setupPkg({ 'my-cli': '^1.0.0' })
  expect(detectPackageSpecifier('my-cli')).toBe('my-cli')
})

test('returns bare name for tag specifier', () => {
  setupPkg({ 'my-cli': 'latest' })
  expect(detectPackageSpecifier('my-cli')).toBe('my-cli')
})

function setupScopedEntry(rootDeps: Record<string, string> | null) {
  const pkgDir = join(tmp, 'node_modules', '@scope', 'pkg')
  mkdirSync(join(pkgDir, 'dist'), { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: '@scope/pkg' }))
  writeFileSync(join(pkgDir, 'dist', 'bin.js'), '')
  if (rootDeps) writeFileSync(join(tmp, 'package.json'), JSON.stringify({ dependencies: rootDeps }))
  process.argv[1] = join(pkgDir, 'dist', 'bin.js')
}

test('resolves the package name from the entrypoint package.json when it differs from the bin name', () => {
  setupScopedEntry(null)
  expect(detectPackageSpecifier('my-cli')).toBe('@scope/pkg')
})

test('resolves the root specifier under the entrypoint package name', () => {
  setupScopedEntry({ '@scope/pkg': 'https://pkg.pr.new/@scope/pkg@abc123' })
  expect(detectPackageSpecifier('my-cli')).toBe('https://pkg.pr.new/@scope/pkg@abc123')
})

test('returns package-name@version for pinned scoped installs', () => {
  setupScopedEntry({ '@scope/pkg': '1.2.3' })
  expect(detectPackageSpecifier('my-cli')).toBe('@scope/pkg@1.2.3')
})

// --- register tests ---
//
// add-mcp is mocked here: these tests cover incur's orchestration (target
// resolution, Amp handling, command splitting), not add-mcp's own config
// writing. add-mcp captures the home directory at import, so its real writes
// cannot be redirected by the per-test os mock; the in-process registration end
// to end (including a Node/npx-free standalone binary) is covered separately.

beforeEach(() => {
  addMcp.detectedGlobal = []
  addMcp.detectedProject = []
  addMcp.upserts.length = 0
  addMcp.failFor.clear()
})

test('register writes to each explicitly requested agent', async () => {
  const result = await register('my-cli', {
    command: 'npx my-cli --mcp',
    agents: ['claude-code', 'cursor'],
  })

  expect(result.agents).toEqual(['Claude Code', 'Cursor'])
  expect(addMcp.upserts.map((u) => u.agent)).toEqual(['claude-code', 'cursor'])
  expect(addMcp.upserts[0]!.config).toEqual({ command: 'npx', args: ['my-cli', '--mcp'] })
})

test('register with no agents registers every detected agent plus Amp', async () => {
  addMcp.detectedGlobal = ['claude-code', 'cursor']

  const result = await register('my-cli', { command: 'npx my-cli --mcp' })

  expect(result.agents).toEqual(['Claude Code', 'Cursor', 'Amp'])
  expect(addMcp.upserts.map((u) => u.agent)).toEqual(['claude-code', 'cursor'])
})

test('register with no agents falls back to all known agents when none detected', async () => {
  const result = await register('my-cli', { command: 'npx my-cli --mcp' })

  expect(addMcp.upserts.map((u) => u.agent)).toEqual([
    'claude-code',
    'claude-desktop',
    'cursor',
    'codex',
  ])
  expect(result.agents).toContain('Claude Desktop')
  expect(result.agents).toContain('Amp')
})

test('register skips agents add-mcp reports as failed', async () => {
  addMcp.failFor.add('cursor')

  const result = await register('my-cli', {
    command: 'npx my-cli --mcp',
    agents: ['claude-code', 'cursor'],
  })

  expect(result.agents).toEqual(['Claude Code'])
})

test('register maps --no-global to a local install', async () => {
  await register('my-cli', {
    command: 'npx my-cli --mcp',
    agents: ['claude-code'],
    global: false,
  })

  expect(addMcp.upserts[0]!.options).toEqual({ local: true })
})

test('register with agents: ["amp"] writes only Amp and skips add-mcp', async () => {
  const result = await register('my-cli', {
    command: 'npx my-cli --mcp',
    agents: ['amp'],
  })

  expect(result.agents).toEqual(['Amp'])
  expect(addMcp.upserts).toEqual([])

  const config = JSON.parse(
    readFileSync(join(fakeHome!, '.config', 'amp', 'settings.json'), 'utf-8'),
  )
  expect(config['amp.mcpServers']['my-cli']).toEqual({ command: 'npx', args: ['my-cli', '--mcp'] })
})

test('register handles quoted command paths with spaces', async () => {
  const result = await register('my-cli', {
    command: '"/path/to my/cli" --mcp',
    agents: ['amp'],
  })

  expect(result.agents).toEqual(['Amp'])

  const config = JSON.parse(
    readFileSync(join(fakeHome!, '.config', 'amp', 'settings.json'), 'utf-8'),
  )
  expect(config['amp.mcpServers']['my-cli']).toEqual({
    command: '/path/to my/cli',
    args: ['--mcp'],
  })
})

test('register uses bare name for global binary installs', async () => {
  process.argv[1] = '/usr/local/bin/my-cli'

  const result = await register('my-cli', { agents: ['claude-code'] })

  expect(result.command).toBe('my-cli --mcp')
  expect(addMcp.upserts[0]!.config).toEqual({ command: 'my-cli', args: ['--mcp'] })
})

test('register uses the real binary path for bun compiled standalone binaries', async () => {
  process.argv[1] = '/$bunfs/root/index.js'

  const result = await register('my-cli', { agents: ['claude-code'] })

  expect(result.command).toBe(`"${process.execPath}" --mcp`)
  expect(addMcp.upserts[0]!.config).toEqual({ command: process.execPath, args: ['--mcp'] })
})

test('register uses runner for source entrypoints outside node_modules', async () => {
  process.argv[1] = join(tmp, 'dist', 'bin.js')

  const result = await register('my-cli', { agents: ['claude-code'] })

  expect(result.command).toMatch(/^(npx|pnpx|bunx)\s/)
  expect(result.command).toContain('my-cli --mcp')
})

test('register uses bare name for global package entrypoints under node_modules', async () => {
  process.argv[1] = join(tmp, 'global', 'node_modules', 'my-cli', 'dist', 'bin.js')

  const result = await register('my-cli', { agents: ['claude-code'] })

  expect(result.command).toBe('my-cli --mcp')
})

test('register uses runner for project dev dependency entrypoints under node_modules', async () => {
  writeFileSync(
    join(tmp, 'package.json'),
    JSON.stringify({ devDependencies: { 'my-cli': '1.0.0' } }),
  )
  process.argv[1] = join(tmp, 'node_modules', 'my-cli', 'dist', 'bin.js')

  const result = await register('my-cli', { agents: ['claude-code'] })

  expect(result.command).toMatch(/^(npx|pnpx|bunx)\s/)
  expect(result.command).toContain('my-cli --mcp')
})

test('register uses runner for node_modules installs', async () => {
  process.argv[1] = join(tmp, 'node_modules', '.bin', 'my-cli')

  const result = await register('my-cli', { agents: ['claude-code'] })

  expect(result.command).toMatch(/^(npx|pnpx|bunx)\s/)
  expect(result.command).toContain('--mcp')
})

test('register writes amp config to existing settings', async () => {
  const configDir = join(fakeHome!, '.config', 'amp')
  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(configDir, 'settings.json'), JSON.stringify({ 'amp.theme': 'dark' }))

  await register('my-cli', { command: 'npx my-cli --mcp', agents: ['amp'] })

  const config = JSON.parse(readFileSync(join(configDir, 'settings.json'), 'utf-8'))
  expect(config['amp.theme']).toBe('dark')
  expect(config['amp.mcpServers']['my-cli']).toBeDefined()
})
