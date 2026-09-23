---
'incur': patch
---

Coerce flag and env values to number literals, so options typed as a number union (such as an OpenAPI integer enum `5 | 10 | 15`) accept `--duration 15` instead of failing validation.
