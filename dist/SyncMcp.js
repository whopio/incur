import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { detectRunner } from './internal/pm.js';
/** Registers the CLI as an MCP server via `npx add-mcp` and direct config writes for unsupported agents. */
export async function register(name, options = {}) {
    const runner = detectRunner();
    const command = options.command ?? defaultCommand(name, runner);
    const targetAgents = options.agents ?? [];
    const ampOnly = targetAgents.length === 1 && targetAgents[0] === 'amp';
    const agents = [];
    // Run add-mcp for agents it supports (skip if only targeting Amp)
    if (!ampOnly) {
        const args = [...addMcpCommandArgs(command), '--name', name, '-y'];
        if (options.global !== false)
            args.push('-g');
        for (const agent of targetAgents.filter((a) => a !== 'amp'))
            args.push('-a', agent);
        const [cmd, ...prefix] = runner.split(' ');
        const { stdout } = await exec(cmd, [...prefix, 'add-mcp', ...args]);
        // Extract agent names from add-mcp output (lines like "│ ✓ Claude Code: ~/.claude.json │")
        agents.push(...stdout
            .split('\n')
            .filter((l) => l.includes('✓') || l.includes('✔'))
            .map((l) => l
            .replace(/[│┃|]/g, '')
            .replace(/.*[✓✔]\s*/, '')
            .replace(/:.*/, '')
            .trim())
            .filter(Boolean));
    }
    // Register with Amp directly (add-mcp doesn't support it)
    if (targetAgents.length === 0 || targetAgents.includes('amp')) {
        const registered = registerAmp(name, command);
        if (registered)
            agents.push('Amp');
    }
    return { command, agents };
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
function defaultCommand(name, runner) {
    if (isStandaloneBinary())
        return `"${process.execPath}" --mcp`;
    return shouldUseBareCommand(name)
        ? `${name} --mcp`
        : `${runner} ${detectPackageSpecifier(name)} --mcp`;
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
function shouldUseBareCommand(name) {
    const bin = process.argv[1];
    if (!bin)
        return false;
    const info = nodeModulesInfo();
    if (info)
        return !info.entry.startsWith('.bin/') && !packageDependsOn(info.root, name);
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
/** @internal Detects the package specifier used to run this CLI (handles dlx/npx URL and version installs). */
export function detectPackageSpecifier(name) {
    const info = nodeModulesInfo();
    if (!info)
        return name;
    try {
        const pkg = JSON.parse(readFileSync(join(info.root, 'package.json'), 'utf-8'));
        const deps = pkg.dependencies ?? {};
        const spec = deps[name];
        if (!spec || Object.keys(deps).length !== 1)
            return name;
        if (/^https?:\/\//.test(spec) || spec.startsWith('file:'))
            return spec;
        if (/^\d/.test(spec))
            return `${name}@${spec}`;
    }
    catch { }
    return name;
}
/**
 * @internal Builds the add-mcp arguments for a command string. add-mcp splits
 * command strings on spaces without unquoting, so a quoted binary path ends up
 * with literal quotes in the written config; an unquoted absolute path swallows
 * the flags into the command. Path commands are therefore passed as a bare
 * positional plus repeatable `--args`; runner commands (`npx ...`) are passed
 * as-is since add-mcp parses those correctly.
 */
function addMcpCommandArgs(command) {
    const [bin, ...binArgs] = splitCommand(command);
    if (!bin || !looksLikePath(bin))
        return [command];
    return [bin, ...binArgs.flatMap((arg) => ['--args', arg])];
}
/** @internal Mirrors add-mcp's own path detection. */
function looksLikePath(input) {
    return (input.startsWith('/') ||
        input.startsWith('~/') ||
        input.startsWith('./') ||
        input.startsWith('../') ||
        /^[A-Za-z]:[\\/]/.test(input));
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
/** Promisified execFile with stderr in error message. */
function exec(cmd, args) {
    return new Promise((resolve, reject) => {
        execFile(cmd, args, (error, stdout, stderr) => {
            if (error) {
                const msg = stderr?.trim() || stdout?.trim() || error.message;
                reject(new Error(msg));
            }
            else
                resolve({ stdout, stderr });
        });
    });
}
//# sourceMappingURL=SyncMcp.js.map