/**
 * Registers the CLI as an MCP server. Agent config writes run in-process through
 * add-mcp's library rather than a spawned `npx add-mcp`, so a standalone binary
 * (which bundles add-mcp at build time) registers without Node or npx installed.
 * Amp is written directly since add-mcp does not support it.
 */
export declare function register(name: string, options?: register.Options): Promise<register.Result>;
export declare namespace register {
    /** Options for registering an MCP server. */
    type Options = {
        /** Target specific agents (e.g. `'claude-code'`, `'cursor'`). */
        agents?: string[] | undefined;
        /** Override the command agents will run. Defaults to `<runner> <name> --mcp`. */
        command?: string | undefined;
        /** Install globally. Defaults to `true`. */
        global?: boolean | undefined;
    };
    /** Result of a register operation. */
    type Result = {
        /** Agents the server was registered with. */
        agents: string[];
        /** The command registered. */
        command: string;
    };
}
/** @internal Detects the package specifier used to run this CLI (handles dlx/npx URL and version installs). */
export declare function detectPackageSpecifier(name: string): string;
//# sourceMappingURL=SyncMcp.d.ts.map