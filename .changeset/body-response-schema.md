---
"incur": minor
---

Add a `--response-body` global flag that prints a command's response body schema: the OpenAPI success response schema (with `$ref`s inlined) on generated commands, the declared `output` schema on hand-written commands, and a map of every subcommand's schema on a group. Raw fetch commands do not support it; `--body` there remains the curl-style request body flag.
