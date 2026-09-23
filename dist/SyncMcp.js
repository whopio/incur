import { agents as agentRegistry, detectGlobalAgents, detectProjectAgents, getAgentTypes, upsertServer, } from 'add-mcp';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { detectRunner } from './internal/pm.js';
const exactVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;
const safePackageNamePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
/**
 * Registers the CLI as an MCP server. Agent config writes run in-process through
 * add-mcp's library rather than a spawned `npx add-mcp`, so a standalone binary
 * (which bundles add-mcp at build time) registers without Node or npx installed.
 * Amp is written directly since add-mcp does not support it.
 */
export async function register(name, options = {}) {
    const runner = detectRunner();
    const command = options.command ?? defaultCommand(options.cli ?? name, runner, options.package, options.version);
    const explicit = (options.agents ?? []).filter(Boolean);
    const [cmd, ...args] = splitCommand(command);
    const agents = [];
    const nonAmp = explicit.filter((a) => a !== 'amp');
    const ampOnly = explicit.length > 0 && nonAmp.length === 0;
    // Register every add-mcp-supported agent (skip if only targeting Amp).
    if (!ampOnly && cmd) {
        const global = options.global !== false;
        for (const agent of await resolveTargets(nonAmp, global)) {
            const result = upsertServer(agent, name, { command: cmd, args }, { local: !global });
            if (result.success)
                agents.push(agentRegistry[agent]?.displayName ?? agent);
        }
    }
    // Register with Amp directly (add-mcp doesn't support it).
    if ((explicit.length === 0 || explicit.includes('amp')) && registerAmp(name, command)) {
        agents.push('Amp');
    }
    return { command, agents };
}
/**
 * @internal Resolves which agents to register with. An explicit list is honored
 * as given (filtered to agents add-mcp knows); otherwise every installed agent
 * is detected, falling back to all known agents when none are detected — matching
 * add-mcp's own non-interactive (`-y`) behavior.
 */
async function resolveTargets(explicit, global) {
    const known = new Set(getAgentTypes());
    if (explicit.length > 0)
        return explicit.filter((a) => known.has(a));
    const detected = global ? await detectGlobalAgents() : detectProjectAgents();
    return detected.length > 0 ? detected : getAgentTypes();
}
/** @internal Registers an MCP server in Amp's settings.json. */
function registerAmp(name, command) {
    const configPath = join(homedir(), '.config', 'amp', 'settings.json');
    let config = {};
    if (existsSync(configPath)) {
        try {
            config = JSON.parse(readFileSync(configPath, 'utf-8'));
        }
        catch {
            return false;
        }
    }
    const [cmd, ...args] = splitCommand(command);
    if (!cmd)
        return false;
    const servers = config['amp.mcpServers'] ?? {};
    servers[name] = { command: cmd, args };
    config['amp.mcpServers'] = servers;
    const dir = dirname(configPath);
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    return true;
}
/** @internal Builds the default MCP command for the current launch mode. */
function defaultCommand(name, runner, pkg, version) {
    if (isStandaloneBinary())
        return `"${process.execPath}" --mcp`;
    const specifier = pkg !== undefined ? detectPackageSpecifier(name, pkg, version) : undefined;
    return shouldUseBareCommand(name, pkg)
        ? `${name} --mcp`
        : `${runner} ${specifier ?? detectPackageSpecifier(name)} --mcp`;
}
/** @internal Bun compiled binaries expose a virtual path as argv[1] (`/$bunfs/` on unix, `B:\~BUN\` on Windows); the real on-disk binary is process.execPath. */
function isStandaloneBinary() {
    const bin = process.argv[1]?.replace(/\\/g, '/');
    if (!bin)
        return false;
    return bin.startsWith('/$bunfs/') || bin.includes('/~BUN/');
}
/** @internal Returns node_modules path details for the current entrypoint. */
function nodeModulesInfo() {
    const normalized = process.argv[1]?.replace(/\\/g, '/');
    const match = normalized?.match(/^(.+)\/node_modules\/(.+)$/);
    if (!match)
        return null;
    return { root: match[1], entry: match[2] };
}
/** @internal Uses the bare command only when the binary is expected on PATH. */
function shouldUseBareCommand(name, pkg) {
    const bin = process.argv[1];
    if (!bin)
        return false;
    const info = nodeModulesInfo();
    if (info)
        return !info.entry.startsWith('.bin/') && !packageDependsOn(info.root, pkg ?? name);
    const file = bin.replace(/\\/g, '/').split('/').pop();
    return file === name || file === `${name}.cmd` || file === `${name}.ps1`;
}
/** @internal Checks whether the entrypoint came from a project dependency install. */
function packageDependsOn(root, name) {
    try {
        const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
        const dependencyFields = [
            pkg.dependencies,
            pkg.devDependencies,
            pkg.optionalDependencies,
            pkg.peerDependencies,
        ];
        return dependencyFields.some((dependencies) => name in (dependencies ?? {}));
    }
    catch {
        return false;
    }
}
/** @internal Detects the safe package specifier used to run this CLI. */
export function detectPackageSpecifier(name, pkg, version) {
    if (pkg !== undefined) {
        if (!safePackageNamePattern.test(pkg))
            throw new Error(`Invalid npm package name: ${pkg}`);
        if (version !== undefined && !exactVersionPattern.test(version))
            throw new Error(`Invalid exact package version: ${version}`);
        return version === undefined ? pkg : `${pkg}@${version}`;
    }
    return name;
}
/** Splits a command string into tokens, respecting single and double quotes. */
function splitCommand(input) {
    const tokens = [];
    let current = '';
    let quote = null;
    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (quote) {
            if (ch === quote)
                quote = null;
            else
                current += ch;
        }
        else if (ch === '"' || ch === "'") {
            quote = ch;
        }
        else if (ch === ' ') {
            if (current)
                tokens.push(current);
            current = '';
        }
        else {
            current += ch;
        }
    }
    if (current)
        tokens.push(current);
    return tokens;
}
//# sourceMappingURL=SyncMcp.js.map