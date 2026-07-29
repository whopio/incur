/** Checks whether a value is a plain object record. */
export declare function isRecord(value: unknown): value is Record<string, unknown>;
/** Converts a camelCase string to kebab-case. */
export declare function toKebab(value: string): string;
/** Computes the Levenshtein edit distance between two strings. */
export declare function levenshtein(a: string, b: string): number;
/** Suggests the closest command name from a set, returning it if within a reasonable edit distance. */
export declare function suggest(input: string, candidates: Iterable<string>): string | undefined;
/**
 * Reads a schema's description, falling back to the type it wraps.
 *
 * `.describe()` before `.optional()` leaves the description on the inner schema, so reading only
 * the outer wrapper silently drops help text.
 */
export declare function describedAs(schema: unknown): string | undefined;
//# sourceMappingURL=helpers.d.ts.map