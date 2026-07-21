import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { detectRunner } from './internal/pm.js'

/** Registers the CLI as an MCP server via `npx add-mcp` and direct config writes for unsupported agents. */
export async function register(
  name: string,
  options: register.Options = {},
): Promise<register.Result> {
  const runner = detectRunner()
  const command = options.command ?? defaultCommand(name, runner)
  const targetAgents = options.agents ?? []
  const ampOnly = targetAgents.length === 1 && targetAgents[0] === 'amp'

  const agents: string[] = []

  // Run add-mcp for agents it supports (skip if only targeting Amp)
  if (!ampOnly) {
    const args = [...addMcpCommandArgs(command), '--name', name, '-y']
    if (options.global !== false) args.push('-g')
    for (const agent of targetAgents.filter((a) => a !== 'amp')) args.push('-a', agent)

    const [cmd, ...prefix] = runner.split(' ')
    const { stdout } = await exec(cmd!, [...prefix, 'add-mcp', ...args])

    // Extract agent names from add-mcp output (lines like "│ ✓ Claude Code: ~/.claude.json │")
    agents.push(
      ...stdout
        .split('\n')
        .filter((l) => l.includes('✓') || l.includes('✔'))
        .map((l) =>
          l
            .replace(/[│┃|]/g, '')
            .replace(/.*[✓✔]\s*/, '')
            .replace(/:.*/, '')
            .trim(),
        )
        .filter(Boolean),
    )
  }

  // Register with Amp directly (add-mcp doesn't support it)
  if (targetAgents.length === 0 || targetAgents.includes('amp')) {
    const registered = registerAmp(name, command)
    if (registered) agents.push('Amp')
  }

  return { command, agents }
}

/** @internal Registers an MCP server in Amp's settings.json. */
function registerAmp(name: string, command: string): boolean {
  const configPath = join(homedir(), '.config', 'amp', 'settings.json')

  let config: Record<string, any> = {}
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, 'utf-8'))
    } catch {
      return false
    }
  }

  const [cmd, ...args] = splitCommand(command)
  if (!cmd) return false

  const servers: Record<string, any> = config['amp.mcpServers'] ?? {}
  servers[name] = { command: cmd, args }
  config['amp.mcpServers'] = servers

  const dir = dirname(configPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')

  return true
}

export declare namespace register {
  /** Options for registering an MCP server. */
  type Options = {
    /** Target specific agents (e.g. `'claude-code'`, `'cursor'`). */
    agents?: string[] | undefined
    /** Override the command agents will run. Defaults to `<runner> <name> --mcp`. */
    command?: string | undefined
    /** Install globally. Defaults to `true`. */
    global?: boolean | undefined
  }

  /** Result of a register operation. */
  type Result = {
    /** Agents the server was registered with. */
    agents: string[]
    /** The command registered. */
    command: string
  }
}

/** @internal Builds the default MCP command for the current launch mode. */
function defaultCommand(name: string, runner: string): string {
  if (isStandaloneBinary()) return `"${process.execPath}" --mcp`
  return shouldUseBareCommand(name)
    ? `${name} --mcp`
    : `${runner} ${detectPackageSpecifier(name)} --mcp`
}

/** @internal Bun compiled binaries expose a virtual path as argv[1] (`/$bunfs/` on unix, `B:\~BUN\` on Windows); the real on-disk binary is process.execPath. */
function isStandaloneBinary(): boolean {
  const bin = process.argv[1]?.replace(/\\/g, '/')
  if (!bin) return false
  return bin.startsWith('/$bunfs/') || bin.includes('/~BUN/')
}

/** @internal Returns node_modules path details for the current entrypoint. */
function nodeModulesInfo(): { entry: string; root: string } | null {
  const normalized = process.argv[1]?.replace(/\\/g, '/')
  const match = normalized?.match(/^(.+)\/node_modules\/(.+)$/)
  if (!match) return null
  return { root: match[1]!, entry: match[2]! }
}

/** @internal Uses the bare command only when the binary is expected on PATH. */
function shouldUseBareCommand(name: string): boolean {
  const bin = process.argv[1]
  if (!bin) return false

  const info = nodeModulesInfo()
  if (info)
    return (
      !info.entry.startsWith('.bin/') &&
      !packageDependsOn(info.root, entryPackageName() ?? name)
    )

  const file = bin.replace(/\\/g, '/').split('/').pop()
  return file === name || file === `${name}.cmd` || file === `${name}.ps1`
}

/**
 * @internal Resolves the npm package name of the running entrypoint by walking
 * up from the (symlink-resolved) argv[1] to the nearest package.json. The bin
 * name is not necessarily the package name (e.g. bin `whop` in package
 * `@whop/cli`), and a runner command built from the bin name would install the
 * wrong package.
 */
function entryPackageName(): string | null {
  const bin = process.argv[1]
  if (!bin) return null

  let dir: string
  try {
    dir = dirname(realpathSync(bin))
  } catch {
    return null
  }

  while (true) {
    const pkgPath = join(dir, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
        if (typeof pkg.name === 'string' && pkg.name) return pkg.name
      } catch {}
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** @internal Checks whether the entrypoint came from a project dependency install. */
function packageDependsOn(root: string, name: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))
    const dependencyFields = [
      pkg.dependencies,
      pkg.devDependencies,
      pkg.optionalDependencies,
      pkg.peerDependencies,
    ]
    return dependencyFields.some((dependencies) => name in (dependencies ?? {}))
  } catch {
    return false
  }
}

/** @internal Detects the package specifier used to run this CLI (handles dlx/npx URL and version installs). */
export function detectPackageSpecifier(name: string): string {
  const pkgName = entryPackageName() ?? name
  const info = nodeModulesInfo()
  if (!info) return pkgName

  try {
    const pkg = JSON.parse(readFileSync(join(info.root, 'package.json'), 'utf-8'))
    const deps = pkg.dependencies ?? {}
    const spec = deps[pkgName]
    if (!spec || Object.keys(deps).length !== 1) return pkgName

    if (/^https?:\/\//.test(spec) || spec.startsWith('file:')) return spec
    if (/^\d/.test(spec)) return `${pkgName}@${spec}`
  } catch {}

  return pkgName
}

/**
 * @internal Builds the add-mcp arguments for a command string. add-mcp splits
 * command strings on spaces without unquoting, so a quoted binary path ends up
 * with literal quotes in the written config; an unquoted absolute path swallows
 * the flags into the command. Path commands are therefore passed as a bare
 * positional plus repeatable `--args`; runner commands (`npx ...`) are passed
 * as-is since add-mcp parses those correctly.
 */
function addMcpCommandArgs(command: string): string[] {
  const [bin, ...binArgs] = splitCommand(command)
  if (!bin || !looksLikePath(bin)) return [command]
  return [bin, ...binArgs.flatMap((arg) => ['--args', arg])]
}

/** @internal Mirrors add-mcp's own path detection. */
function looksLikePath(input: string): boolean {
  return (
    input.startsWith('/') ||
    input.startsWith('~/') ||
    input.startsWith('./') ||
    input.startsWith('../') ||
    /^[A-Za-z]:[\\/]/.test(input)
  )
}

/** Splits a command string into tokens, respecting single and double quotes. */
function splitCommand(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: string | null = null

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!
    if (quote) {
      if (ch === quote) quote = null
      else current += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === ' ') {
      if (current) tokens.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current) tokens.push(current)
  return tokens
}

/**
 * Promisified execFile with stderr in error message. Runs through a shell on
 * Windows: package-manager runners (`npx`, `pnpx`, `bunx`) are `.cmd` shims
 * there, which Node refuses to spawn without one (CVE-2024-27980 hardening).
 * The shell joins args with spaces, so args are quoted first.
 */
function exec(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const windows = process.platform === 'win32'
  const finalArgs = windows
    ? args.map((arg) => (/[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg))
    : args
  return new Promise((resolve, reject) => {
    execFile(cmd, finalArgs, { shell: windows }, (error, stdout, stderr) => {
      if (error) {
        const msg = stderr?.trim() || stdout?.trim() || error.message
        reject(new Error(msg))
      } else resolve({ stdout, stderr })
    })
  })
}
