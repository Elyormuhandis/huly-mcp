---
"@firfi/huly-mcp": minor
---

Add issue type (task type) support and fix file uploads behind a redirecting host.

- `create_issue` / `update_issue` now accept an optional `type` (task type name or id, e.g. `"Bug"`), resolved within the issue's project type. Defaults to the built-in Issue type.
- File uploads (`add_attachment`, `add_issue_attachment`, `add_document_attachment`) now resolve the canonical host before POSTing. When `HULY_URL` 301-redirects (e.g. `huly.example` → `office.example`), `fetch` downgraded the redirected upload POST to a GET and dropped the body + Authorization header, so uploads failed with an empty-message `StorageError`. The storage client now targets the final host directly.
