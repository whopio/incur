import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  type AgentType,
  agents as agentRegistry,
  detectGlobalAgents,
  detectProjectAgents,
  getAgentTypes,
  upsertServer,
} from 'add-mcp'

import { detectRunner } from './internal/pm.js'

/**
 * Registers the CLI as an MCP server. Agent config writes run in-process through
 * add-mcp's library rather than a spawned `npx add-mcp`, so a standalone binary
 * (which bundles add-mcp at build time) registers without Node or npx installed.
 * Amp is written directly since add-mcp does not support it.
 */
export async function register(
  name: string,
  options: register.Options = {},
): Promise<register.Result> {
  const command = options.command ?? defaultCommand(name, detectRunner())
  const explicit = (options.agents ?? []).filter(Boolean)
  const [cmd, ...args] = splitCommand(command)

  const agents: string[] = []

  const nonAmp = explicit.filter((a) => a !== 'amp')
  const ampOnly = explicit.length > 0 && nonAmp.length === 0

  // Register every add-mcp-supported agent (skip if only targeting Amp).
  if (!ampOnly && cmd) {
    const global = options.global !== false
    for (const agent of await resolveTargets(nonAmp, global)) {
      const result = upsertServer(agent, name, { command: cmd, args }, { local: !global })
      if (result.success) agents.push(agentRegistry[agent]?.displayName ?? agent)
    }
  }

  // Register with Amp directly (add-mcp doesn't support it).
  if ((explicit.length === 0 || explicit.includes('amp')) && registerAmp(name, command)) {
    agents.push('Amp')
  }

  return { command, agents }
}

/**
 * @internal Resolves which agents to register with. An explicit list is honored
 * as given (filtered to agents add-mcp knows); otherwise every installed agent
 * is detected, falling back to all known agents when none are detected — matching
 * add-mcp's own non-interactive (`-y`) behavior.
 */
async function resolveTargets(explicit: string[], global: boolean): Promise<AgentType[]> {
  const known = new Set<string>(getAgentTypes())
  if (explicit.length > 0) return explicit.filter((a): a is AgentType => known.has(a))

  const detected = global ? await detectGlobalAgents() : detectProjectAgents()
  return detected.length > 0 ? detected : getAgentTypes()
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
