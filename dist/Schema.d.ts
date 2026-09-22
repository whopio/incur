import { z } from 'zod';
/** A JSON Schema object, as an OpenAPI document carries one. */
export type JsonSchema = Record<string, unknown>;
/** Whether a value is a Zod schema rather than a JSON Schema object. */
export declare function isZod(schema: z.ZodType | JsonSchema): schema is z.ZodType;
/**
 * Converts a Zod schema to a JSON Schema object. Strips the `$schema`
 * meta-property. Represents bigints and dates as `{ type: "string" }`
 * since JSON lacks native types for them. A JSON Schema object passes
 * through as a shallow copy with `$schema` stripped, so a command generated
 * from an OpenAPI operation can carry the operation's own response schema
 * without a lossy round trip through Zod.
 */
export declare function toJsonSchema(schema: z.ZodType | JsonSchema): Record<string, unknown>;
//# sourceMappingURL=Schema.d.ts.map