import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { detectPackageSpecifier, isPackageName, register } from './SyncMcp.js'

const addMcp = vi.hoisted(() => ({
  agents: {
    'claude-code': { displayName: 'Claude Code', localConfigPath: '.mcp.json' },
    'claude-desktop': { displayName: 'Claude Desktop' },
    cursor: { displayName: 'Cursor', localConfigPath: '.cursor/mcp.json' },
    'gemini-cli': { displayName: 'Gemini CLI', localConfigPath: '.gemini/settings.json' },
    vscode: { displayName: 'VS Code', localConfigPath: '.vscode/mcp.json' },
  } as Record<string, { displayName: string; localConfigPath?: string }>,
  detectedGlobal: [] as string[],
  detectedProject: [] as string[],
  errors: {} as Record<string, string>,
  upserts: [] as { agent: string; name: string; config: unknown; options: unknown }[],
}))

vi.mock('add-mcp', () => ({
  agents: addMcp.agents,
  detectGlobalAgents: async () => addMcp.detectedGlobal,
  detectProjectAgents: () => addMcp.detectedProject,
  getAgentTypes: () => Object.keys(addMcp.agents),
  upsertServer(agent: string, name: string, config: unknown, options: unknown) {
    addMcp.upserts.push({ agent, name, config, options })
    const error = addMcp.errors[agent]
    return error ? { success: false, path: '', error } : { success: true, path: '' }
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
  addMcp.detectedGlobal = []
  addMcp.detectedProject = []
  addMcp.errors = {}
  addMcp.upserts = []
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

test('returns bare name for https dep', () => {
  setupPkg({ 'my-cli': 'https://pkg.pr.new/my-cli@abc123' })
  expect(detectPackageSpecifier('my-cli')).toBe('my-cli')
})

test('returns bare name for file: dep', () => {
  setupPkg({ 'my-cli': 'file:../local-cli' })
  expect(detectPackageSpecifier('my-cli')).toBe('my-cli')
})

test('never emits dependency specs containing whitespace or flags', () => {
  setupPkg({ 'my-cli': '1.2.3 --inspect' })
  expect(detectPackageSpecifier('my-cli')).toBe('my-cli')
  expect(detectPackageSpecifier('my-cli', '@example/cli')).toBe('@example/cli')
  expect(() => detectPackageSpecifier('my-cli', 'https://example.com/cli', '1.2.3')).toThrow()
  expect(() => detectPackageSpecifier('my-cli', '@example/cli', '1.2.3 --inspect')).toThrow()
})

test('returns bare name for pinned version', () => {
  setupPkg({ 'my-cli': '1.2.3' })
  expect(detectPackageSpecifier('my-cli')).toBe('my-cli')
})

test('returns bare name for range specifier', () => {
  setupPkg({ 'my-cli': '^1.0.0' })
  expect(detectPackageSpecifier('my-cli')).toBe('my-cli')
})

test('returns bare name for tag specifier', () => {
  setupPkg({ 'my-cli': 'latest' })
  expect(detectPackageSpecifier('my-cli')).toBe('my-cli')
})

// --- isPackageName tests ---

test.each([
  ['my-cli', true],
  ['@example/my-cli', true],
  ['tempo wallet', false],
  ['My-CLI', false],
  ['my-cli --inspect', false],
  ['', false],
])('isPackageName(%j) is %s', (name, expected) => {
  expect(isPackageName(name)).toBe(expected)
})

// --- register tests ---

test('register writes detected agents through add-mcp and writes amp config', async () => {
  addMcp.detectedGlobal = ['claude-code', 'cursor']

  const result = await register('my-cli', { command: 'npx my-cli --mcp' })

  expect(result.command).toBe('npx my-cli --mcp')
  expect(result.agents).toEqual(['Claude Code', 'Cursor', 'Amp'])
  expect(addMcp.upserts).toEqual([
    {
      agent: 'claude-code',
      name: 'my-cli',
      config: { command: 'npx', args: ['my-cli', '--mcp'] },
      options: { local: false },
    },
    {
      agent: 'cursor',
      name: 'my-cli',
      config: { command: 'npx', args: ['my-cli', '--mcp'] },
      options: { local: false },
    },
  ])

  const configPath = join(fakeHome!, '.config', 'amp', 'settings.json')
  expect(existsSync(configPath)).toBe(true)
  const config = JSON.parse(readFileSync(configPath, 'utf-8'))
  expect(config['amp.mcpServers']['my-cli']).toEqual({
    command: 'npx',
    args: ['my-cli', '--mcp'],
  })
})

test('register falls back to every agent when none are detected', async () => {
  const result = await register('my-cli', { command: 'npx my-cli --mcp' })

  expect(addMcp.upserts.map((upsert) => upsert.agent)).toEqual(Object.keys(addMcp.agents))
  expect(result.agents).toEqual([
    'Claude Code',
    'Claude Desktop',
    'Cursor',
    'Gemini CLI',
    'VS Code',
    'Amp',
  ])
})

test('register without global uses detected project agents', async () => {
  addMcp.detectedProject = ['cursor']

  await register('my-cli', { command: 'npx my-cli --mcp', global: false })

  expect(addMcp.upserts.map(({ agent, options }) => ({ agent, options }))).toEqual([
    { agent: 'cursor', options: { local: true } },
  ])
})

test('register without global falls back to project-capable agents', async () => {
  await register('my-cli', { command: 'npx my-cli --mcp', global: false })

  expect(addMcp.upserts.map(({ agent, options }) => ({ agent, options }))).toEqual([
    { agent: 'claude-code', options: { local: true } },
    { agent: 'cursor', options: { local: true } },
    { agent: 'gemini-cli', options: { local: true } },
    { agent: 'vscode', options: { local: true } },
  ])
})

test('register without global installs globally when a target has no project config', async () => {
  await register('my-cli', {
    command: 'npx my-cli --mcp',
    agents: ['cursor', 'claude-desktop'],
    global: false,
  })

  expect(addMcp.upserts.map(({ agent, options }) => ({ agent, options }))).toEqual([
    { agent: 'cursor', options: { local: false } },
    { agent: 'claude-desktop', options: { local: false } },
  ])
})

test('register resolves agent names case-insensitively', async () => {
  const result = await register('my-cli', {
    command: 'npx my-cli --mcp',
    agents: ['Cursor', 'gemini-cli', 'cursor', 'AMP'],
  })

  expect(addMcp.upserts.map((upsert) => upsert.agent)).toEqual(['cursor', 'gemini-cli'])
  expect(result.agents).toEqual(['Cursor', 'Gemini CLI', 'Amp'])
})

test('register rejects unknown agents before writing any config', async () => {
  await expect(
    register('my-cli', { command: 'npx my-cli --mcp', agents: ['cursor', 'nope', 'amp'] }),
  ).rejects.toThrow('Invalid agents: nope. Valid agents: amp, claude-code,')

  expect(addMcp.upserts).toEqual([])
  expect(existsSync(join(fakeHome!, '.config', 'amp', 'settings.json'))).toBe(false)
})

test('register rejects when add-mcp fails to write an agent config', async () => {
  addMcp.errors = { cursor: 'EACCES: permission denied' }

  await expect(
    register('my-cli', { command: 'npx my-cli --mcp', agents: ['claude-code', 'cursor'] }),
  ).rejects.toThrow(
    'Failed to register my-cli with Cursor (EACCES: permission denied). Registered with Claude Code.',
  )
  expect(addMcp.upserts.map((upsert) => upsert.agent)).toEqual(['claude-code', 'cursor'])
})

test('register with agents: ["amp"] skips add-mcp', async () => {
  const result = await register('my-cli', {
    command: 'npx my-cli --mcp',
    agents: ['amp'],
  })

  expect(addMcp.upserts).toEqual([])
  expect(result.agents).toEqual(['Amp'])
})

test('register passes quoted command paths to add-mcp unquoted', async () => {
  await register('my-cli', { command: '"/path/to my/cli" --mcp', agents: ['claude-desktop'] })

  expect(addMcp.upserts[0]!.config).toEqual({ command: '/path/to my/cli', args: ['--mcp'] })
})

test('register writes real agent configs in-process without a package runner', async () => {
  const script = join(tmp, 'register.mts')
  writeFileSync(
    script,
    `import { register } from ${JSON.stringify(join(import.meta.dirname, 'SyncMcp.ts'))}
const result = await register('my-cli', { command: '"/path/to my/cli" --mcp', agents: ['Cursor'] })
console.log(JSON.stringify(result))`,
  )

  const stdout = await new Promise<string>((resolve, reject) =>
    execFile(
      process.execPath,
      ['--import', 'tsx', script],
      {
        cwd: join(import.meta.dirname, '..'),
        env: { ...process.env, HOME: fakeHome, PATH: '' },
        timeout: 30_000,
      },
      (error, stdout, stderr) =>
        error ? reject(new Error(stderr || error.message)) : resolve(stdout),
    ),
  )

  expect(JSON.parse(stdout)).toEqual({ command: '"/path/to my/cli" --mcp', agents: ['Cursor'] })
  const config = JSON.parse(readFileSync(join(fakeHome!, '.cursor', 'mcp.json'), 'utf-8'))
  expect(config.mcpServers['my-cli']).toEqual({ command: '/path/to my/cli', args: ['--mcp'] })
}, 30_000)

test('register handles quoted command paths with spaces', async () => {
  const result = await register('my-cli', {
    command: '"/path/to my/cli" --mcp',
    agents: ['amp'],
  })

  expect(result.agents).toEqual(['Amp'])

  const configPath = join(fakeHome!, '.config', 'amp', 'settings.json')
  const config = JSON.parse(readFileSync(configPath, 'utf-8'))
  expect(config['amp.mcpServers']['my-cli']).toEqual({
    command: '/path/to my/cli',
    args: ['--mcp'],
  })
})

test('register uses bare name for global binary installs', async () => {
  process.argv[1] = '/usr/local/bin/my-cli'

  const result = await register('my-cli', {
    agents: ['amp'],
    package: '@example/cli',
    version: '1.2.3',
  })

  expect(result.command).toBe('my-cli --mcp')

  const configPath = join(fakeHome!, '.config', 'amp', 'settings.json')
  const config = JSON.parse(readFileSync(configPath, 'utf-8'))
  expect(config['amp.mcpServers']['my-cli']).toEqual({
    command: 'my-cli',
    args: ['--mcp'],
  })
})

test('register uses runner for source entrypoints outside node_modules', async () => {
  process.argv[1] = join(tmp, 'dist', 'bin.js')

  const result = await register('my-cli', { agents: ['amp'] })

  expect(result.command).toMatch(/^(npx|pnpx|bunx)\s/)
  expect(result.command).toContain('my-cli --mcp')
})

test('register uses the detected runner with an explicit scoped package and version', async () => {
  process.argv[1] = join(tmp, 'dist', 'bin.js')
  vi.stubEnv('npm_config_user_agent', 'pnpm/10.0.0')
  try {
    const result = await register('my-cli', {
      agents: ['amp'],
      package: '@example/cli',
      version: '1.2.3',
    })

    expect(result.command).toBe('pnpx @example/cli@1.2.3 --mcp')
  } finally {
    vi.unstubAllEnvs()
  }
})

test('register uses runner for scoped dependency with different binary name', async () => {
  setupPkg({ '@example/cli': '1.2.3' })
  process.argv[1] = join(tmp, 'node_modules', '@example', 'cli', 'dist', 'bin.js')
  vi.stubEnv('npm_config_user_agent', 'pnpm/10.0.0')
  try {
    const result = await register('my-cli', {
      agents: ['amp'],
      package: '@example/cli',
      version: '1.2.3',
    })

    expect(result.command).toBe('pnpx @example/cli@1.2.3 --mcp')
  } finally {
    vi.unstubAllEnvs()
  }
})

test('register derives the command from a different CLI name', async () => {
  process.argv[1] = join(tmp, 'dist', 'bin.js')

  const result = await register('example', { agents: ['amp'], cli: 'my-cli' })

  expect(result.command).toMatch(/^(npx|pnpx|bunx)\s/)
  expect(result.command).toContain('my-cli --mcp')

  const configPath = join(fakeHome!, '.config', 'amp', 'settings.json')
  const config = JSON.parse(readFileSync(configPath, 'utf-8'))
  expect(config['amp.mcpServers']['example']).toEqual({
    command: result.command.split(' ')[0],
    args: ['my-cli', '--mcp'],
  })
})

test('register uses bare name for global package entrypoints under node_modules', async () => {
  process.argv[1] = join(tmp, 'global', 'node_modules', 'my-cli', 'dist', 'bin.js')

  const result = await register('my-cli', { agents: ['amp'] })

  expect(result.command).toBe('my-cli --mcp')
})

test('register uses runner for project dev dependency entrypoints under node_modules', async () => {
  writeFileSync(
    join(tmp, 'package.json'),
    JSON.stringify({ devDependencies: { 'my-cli': '1.0.0' } }),
  )
  process.argv[1] = join(tmp, 'node_modules', 'my-cli', 'dist', 'bin.js')

  const result = await register('my-cli', { agents: ['amp'] })

  expect(result.command).toMatch(/^(npx|pnpx|bunx)\s/)
  expect(result.command).toContain('my-cli --mcp')
})

test('register uses runner for node_modules installs', async () => {
  process.argv[1] = join(tmp, 'node_modules', '.bin', 'my-cli')

  const result = await register('my-cli', { agents: ['amp'] })

  // Should include a runner prefix (npx, pnpx, or bunx)
  expect(result.command).toMatch(/^(npx|pnpx|bunx)\s/)
  expect(result.command).toContain('--mcp')
})

test.each([
  // A package runner runs the trusted package, including for a multi-word CLI name.
  { cli: 'my-cli', pkg: '@example/my-cli', command: 'pnpx @example/my-cli --mcp' },
  { cli: 'tempo wallet', pkg: '@tempo/wallet', command: 'pnpx @tempo/wallet --mcp' },
  // Without a package, a CLI name that is a package name is run as that package.
  { cli: 'my-cli', pkg: undefined, command: 'pnpx my-cli --mcp' },
  // Without a package, a CLI name that is not a package name runs the installed binary.
  { cli: 'tempo wallet', pkg: undefined, command: 'tempo wallet --mcp' },
  { cli: 'My-CLI', pkg: undefined, command: 'My-CLI --mcp' },
])('register $cli (package: $pkg) defaults to $command', async ({ cli, pkg, command }) => {
  process.argv[1] = join(tmp, 'dist', 'bin.js')
  vi.stubEnv('npm_config_user_agent', 'pnpm/10.0.0')
  try {
    const result = await register(cli, { agents: ['amp'], package: pkg })
    expect(result.command).toBe(command)

    // Amp runs the first word as the executable and the rest as its arguments.
    const configPath = join(fakeHome!, '.config', 'amp', 'settings.json')
    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    const [executable, ...args] = command.split(' ')
    expect(config['amp.mcpServers'][cli]).toEqual({ command: executable, args })
  } finally {
    vi.unstubAllEnvs()
  }
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
