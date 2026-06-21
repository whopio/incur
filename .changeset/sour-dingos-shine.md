---
'incur': patch
---

Fixed streaming command terminal records so HTTP NDJSON responses preserved returned `c.ok()` CTA metadata, represented returned or yielded `c.error()` values as terminal errors, included terminal duration metadata, unwound generators on response cancellation, and preserved `IncurError.retryable` metadata in streaming machine-format errors.
