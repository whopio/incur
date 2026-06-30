import type { Document } from '@scalar/openapi-types/3.2';
import { z } from 'zod';
import * as Cli from './Cli.js';
/** A minimal OpenAPI 3.x spec shape. Accepts both hand-written specs and generated ones (e.g. from `@hono/zod-openapi`). */
export type OpenAPISpec = {
    components?: {
        securitySchemes?: Record<string, SecurityScheme> | undefined;
    } | undefined;
    info?: Record<string, unknown> | undefined;
    openapi?: string | undefined;
    paths?: {} | undefined;
    security?: readonly SecurityRequirement[] | undefined;
};
/** OpenAPI document source accepted by fetch-backed CLI commands. */
export type OpenAPISource = OpenAPISpec | string | URL;
/** Strategy used to name commands generated from OpenAPI operations. */
export type Mode = 'namespace' | 'operation';
/** Configuration for generating commands from an OpenAPI document. */
export type Config = {
    /** Command naming strategy. Defaults to `'operation'`. */
    mode?: Mode | undefined;
};
/** Options for generating an OpenAPI document from an incur CLI. */
export type GenerateOptions = {
    /** API description. Defaults to the CLI description. */
    description?: string | undefined;
    /** Server URLs to advertise in the generated document. */
    servers?: {
        url: string;
        description?: string | undefined;
    }[] | undefined;
    /** API title. Defaults to the CLI name. */
    title?: string | undefined;
    /** API version. Defaults to `0.0.0`. */
    version?: string | undefined;
};
/** Generates an OpenAPI 3.2 document from an incur CLI's command tree. */
export declare function fromCli(cli: Cli.Cli, options?: GenerateOptions): Document;
type SecurityRequirement = Record<string, readonly string[]>;
type SecurityScheme = {
    description?: string | undefined;
    in?: 'cookie' | 'header' | 'query' | undefined;
    name?: string | undefined;
    scheme?: string | undefined;
    type?: string | undefined;
};
/** A fetch handler. */
type FetchHandler = (req: Request) => Response | Promise<Response>;
/** A generated command entry compatible with incur's internal CommandEntry. */
type GeneratedCommand = {
    args?: z.ZodObject<any> | undefined;
    description?: string | undefined;
    options?: z.ZodObject<any> | undefined;
    run: (context: any) => any;
};
type GeneratedEntry = GeneratedCommand | GeneratedGroup;
type GeneratedGroup = {
    _group: true;
    description?: string | undefined;
    commands: Map<string, GeneratedEntry>;
};
/** Resolves an OpenAPI document from a JSON object or JSON URL. */
export declare function resolve(source: OpenAPISource, options?: resolve.Options): Promise<OpenAPISpec>;
export declare namespace resolve {
    /** Options for resolving an OpenAPI document source. */
    type Options = {
        /** Base URL used to resolve relative OpenAPI document paths. */
        baseUrl?: string | URL | undefined;
    };
}
/** Generates incur command entries from an OpenAPI spec. Resolves all `$ref` pointers. */
export declare function generateCommands(spec: OpenAPISpec, fetch: FetchHandler, options?: generateCommands.Options): Promise<Map<string, GeneratedEntry>>;
export declare namespace generateCommands {
    /** Options for generating incur commands from an OpenAPI spec. */
    type Options = {
        /** Base path prepended to generated request paths. */
        basePath?: string | undefined;
        /** Configuration for generated OpenAPI commands. */
        config?: Config | undefined;
    };
}
export {};
//# sourceMappingURL=Openapi.d.ts.map