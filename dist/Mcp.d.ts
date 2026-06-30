import type { Readable, Writable } from 'node:stream';
import { z } from 'zod';
import { type FormattedCtaBlock } from './internal/cta.js';
import type { Handler as MiddlewareHandler } from './middleware.js';
/** Starts a stdio MCP server that exposes commands as tools. */
export declare function serve(name: string, version: string, commands: Map<string, any>, options?: serve.Options): Promise<void>;
export declare namespace serve {
    /** Options for the MCP server. */
    type Options = {
        /** CLI-level env schema. */
        env?: z.ZodObject<any> | undefined;
        /** Override input stream. Defaults to `process.stdin`. */
        input?: Readable | undefined;
        /** Middleware handlers registered on the root CLI. */
        middlewares?: MiddlewareHandler[] | undefined;
        /** Override output stream. Defaults to `process.stdout`. */
        output?: Writable | undefined;
        /** Vars schema for middleware variables. */
        vars?: z.ZodObject<any> | undefined;
        /** CLI version string. */
        version?: string | undefined;
        /** Instructions describing how to use the server and its features. */
        instructions?: string | undefined;
    };
}
/** @internal Executes a tool call and returns a CallToolResult. */
export declare function callTool(tool: ToolEntry, params: Record<string, unknown>, options?: {
    extra?: {
        mcpReq?: {
            _meta?: {
                progressToken?: string | number;
            };
        };
    };
    sendNotification?: (n: ProgressNotification) => Promise<void>;
    name?: string | undefined;
    version?: string | undefined;
    middlewares?: MiddlewareHandler[] | undefined;
    env?: z.ZodObject<any> | undefined;
    vars?: z.ZodObject<any> | undefined;
}): Promise<{
    content: {
        type: 'text';
        text: string;
    }[];
    structuredContent?: Record<string, unknown>;
    _meta?: {
        cta: FormattedCtaBlock;
    } | undefined;
    isError?: boolean;
}>;
/** @internal A progress notification sent during streaming tool calls. */
type ProgressNotification = {
    method: 'notifications/progress';
    params: {
        progressToken: string | number;
        progress: number;
        message: string;
    };
};
/** @internal A resolved tool entry from the command tree. */
export type ToolEntry = {
    name: string;
    description?: string | undefined;
    inputSchema: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
    };
    outputSchema?: Record<string, unknown> | undefined;
    annotations?: ToolAnnotations | undefined;
    instructions?: string | undefined;
    command: any;
    middlewares?: MiddlewareHandler[] | undefined;
};
/** MCP tool annotations that describe tool behavior to clients. */
export type ToolAnnotations = {
    /** A human-readable title for the tool. */
    title?: string | undefined;
    /** If true, the tool does not modify its environment. Default: false. */
    readOnlyHint?: boolean | undefined;
    /** If true, the tool may perform destructive updates to its environment. Meaningful only when readOnlyHint is false. Default: true. */
    destructiveHint?: boolean | undefined;
    /** If true, calling the tool repeatedly with the same arguments has no additional effect. Meaningful only when readOnlyHint is false. Default: false. */
    idempotentHint?: boolean | undefined;
    /** If true, the tool may interact with an open world of external entities. Default: true. */
    openWorldHint?: boolean | undefined;
};
/** @internal Recursively collects leaf commands as tool entries. */
export declare function collectTools(commands: Map<string, any>, prefix: string[], parentMiddlewares?: MiddlewareHandler[]): ToolEntry[];
export {};
//# sourceMappingURL=Mcp.d.ts.map