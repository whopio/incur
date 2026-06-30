import { z } from 'zod';
import * as Command from './internal/command.js';
import { formatCtaBlock } from './internal/cta.js';
import * as Json from './internal/json.js';
import * as Schema from './Schema.js';
/** Starts a stdio MCP server that exposes commands as tools. */
export async function serve(name, version, commands, options = {}) {
    // Lazy: only runs when actually serving MCP, so plain command runs don't pay for the SDK import.
    const stdio = importStdioModule();
    const mcp = await import('@modelcontextprotocol/server');
    const { fromJsonSchema, McpServer } = mcp;
    const StdioServerTransport = await importStdioServerTransport(mcp, stdio);
    const server = new McpServer({ name, version }, options.instructions ? { instructions: options.instructions } : undefined);
    for (const tool of collectTools(commands, [])) {
        const mergedShape = {
            ...tool.command.args?.shape,
            ...tool.command.options?.shape,
        };
        const hasInput = Object.keys(mergedShape).length > 0;
        server.registerTool(tool.name, {
            ...(tool.description ? { description: tool.description } : undefined),
            ...(hasInput ? { inputSchema: z.object(mergedShape) } : undefined),
            ...(tool.outputSchema ? { outputSchema: fromJsonSchema(tool.outputSchema) } : undefined),
            ...(tool.annotations ? { annotations: tool.annotations } : undefined),
            ...(tool.instructions ? { _meta: { instructions: tool.instructions } } : undefined),
        }, async (...callArgs) => {
            // registerTool passes (args, extra) when inputSchema is set, (extra) when not
            const params = hasInput ? callArgs[0] : {};
            const extra = hasInput ? callArgs[1] : callArgs[0];
            return callTool(tool, params, {
                extra,
                sendNotification: (n) => server.server.notification(n),
                name,
                version,
                middlewares: options.middlewares,
                env: options.env,
                vars: options.vars,
            });
        });
    }
    const input = options.input ?? process.stdin;
    const output = options.output ?? process.stdout;
    const transport = new StdioServerTransport(input, output);
    await server.connect(transport);
}
async function importStdioServerTransport(mcp, stdio) {
    const transport = mcp.StdioServerTransport;
    if (transport)
        return transport;
    const result = await stdio;
    if (result.error)
        throw result.error;
    return result.module.StdioServerTransport;
}
function importStdioModule() {
    return importModule('@modelcontextprotocol/server/stdio')
        .then((module) => ({ module }))
        .catch((error) => ({ error }));
}
const importModule = (specifier) => import(specifier);
/** @internal Executes a tool call and returns a CallToolResult. */
export async function callTool(tool, params, options = {}) {
    const allMiddleware = [
        ...(options.middlewares ?? []),
        ...(tool.middlewares ?? []),
        ...(tool.command.middleware ?? []),
    ];
    const result = await Command.execute(tool.command, {
        agent: true,
        argv: [],
        env: options.env,
        format: 'json',
        formatExplicit: true,
        inputOptions: params,
        middlewares: allMiddleware,
        name: options.name ?? tool.name,
        parseMode: 'flat',
        path: tool.name,
        vars: options.vars,
        version: options.version,
    });
    if ('stream' in result) {
        // Streaming: send progress notifications per chunk, then return buffered result
        const chunks = [];
        const progressToken = options.extra?.mcpReq?._meta?.progressToken;
        let i = 0;
        try {
            for await (const chunk of result.stream) {
                chunks.push(chunk);
                if (progressToken !== undefined && options.sendNotification)
                    await options.sendNotification({
                        method: 'notifications/progress',
                        params: { progressToken, progress: ++i, message: Json.stringify(chunk) },
                    });
            }
        }
        catch (err) {
            return {
                content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
                isError: true,
            };
        }
        return { content: [{ type: 'text', text: Json.stringify(chunks) }] };
    }
    if (!result.ok)
        return {
            content: [
                {
                    type: 'text',
                    text: result.error.fieldErrors
                        ? JSON.stringify(result.error)
                        : (result.error.message ?? 'Command failed'),
                },
            ],
            isError: true,
        };
    const data = result.data ?? null;
    const jsonData = Json.normalize(data);
    const cta = formatCtaBlock(options.name ?? tool.name, result.cta);
    return {
        content: [{ type: 'text', text: Json.stringify(jsonData) }],
        ...(data !== null && tool.outputSchema
            ? { structuredContent: jsonData }
            : undefined),
        ...(cta ? { _meta: { cta } } : undefined),
    };
}
/** @internal Recursively collects leaf commands as tool entries. */
export function collectTools(commands, prefix, parentMiddlewares = []) {
    const result = [];
    for (const [name, entry] of commands) {
        if ('_alias' in entry)
            continue;
        const path = [...prefix, name];
        if ('_group' in entry && entry._group) {
            const groupMw = [
                ...parentMiddlewares,
                ...(entry.middlewares ?? []),
            ];
            result.push(...collectTools(entry.commands, path, groupMw));
        }
        else {
            const outputSchema = entry.output ? mcpOutputSchema(entry.output) : undefined;
            result.push({
                name: entry.mcp?.name ?? path.join('_'),
                description: entry.mcp?.description ?? entry.description,
                inputSchema: buildToolSchema(entry.args, entry.options),
                ...(outputSchema ? { outputSchema } : undefined),
                ...(entry.mcp?.annotations ? { annotations: entry.mcp.annotations } : undefined),
                ...(entry.mcp?.instructions ? { instructions: entry.mcp.instructions } : undefined),
                command: entry,
                ...(parentMiddlewares.length > 0 ? { middlewares: parentMiddlewares } : undefined),
            });
        }
    }
    assertUniqueToolNames(result);
    return result.sort((a, b) => a.name.localeCompare(b.name));
}
function assertUniqueToolNames(tools) {
    const seen = new Set();
    for (const tool of tools) {
        if (seen.has(tool.name))
            throw new Error(`Duplicate MCP tool name: ${tool.name}`);
        seen.add(tool.name);
    }
}
function mcpOutputSchema(output) {
    const schema = Schema.toJsonSchema(output);
    if (schema.type === 'object')
        return schema;
    return undefined;
}
/** @internal Builds a merged JSON Schema from args and options Zod schemas. */
function buildToolSchema(args, options) {
    const properties = {};
    const required = [];
    for (const schema of [args, options]) {
        if (!schema)
            continue;
        const json = Schema.toJsonSchema(schema);
        Object.assign(properties, json.properties ?? {});
        required.push(...(json.required ?? []));
    }
    if (required.length > 0)
        return { type: 'object', properties, required };
    return { type: 'object', properties };
}
//# sourceMappingURL=Mcp.js.map