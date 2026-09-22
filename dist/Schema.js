import { z } from 'zod';
/** Whether a value is a Zod schema rather than a JSON Schema object. */
export function isZod(schema) {
    return schema instanceof z.ZodType || '_zod' in schema;
}
/**
 * Converts a Zod schema to a JSON Schema object. Strips the `$schema`
 * meta-property. Represents bigints and dates as `{ type: "string" }`
 * since JSON lacks native types for them. A JSON Schema object passes
 * through as a shallow copy with `$schema` stripped, so a command generated
 * from an OpenAPI operation can carry the operation's own response schema
 * without a lossy round trip through Zod.
 */
export function toJsonSchema(schema) {
    if (!isZod(schema)) {
        const { $schema: _, ...rest } = schema;
        return rest;
    }
    const result = z.toJSONSchema(schema, {
        unrepresentable: 'any',
        override: (ctx) => {
            const type = ctx.zodSchema._zod?.def?.type;
            if (type === 'bigint' || type === 'date')
                ctx.jsonSchema.type = 'string';
        },
    });
    delete result.$schema;
    return result;
}
//# sourceMappingURL=Schema.js.map