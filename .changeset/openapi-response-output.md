---
'incur': minor
---

Commands generated from an OpenAPI spec now carry the operation's success response schema as `output`, so `--schema`, the MCP tool's `outputSchema`, `--llms-full`, and `fromCli` describe what a command returns. The schema is the spec's own (dereferenced), not a Zod round trip, so field descriptions, formats, enums, examples, and vendor extensions arrive intact and generation costs nothing extra. `Schema.toJsonSchema` accepts a JSON Schema object and passes it through.
