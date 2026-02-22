
## From plans
- **process-lifecycle-safety** — reliable `killProcess` extraction, awaitable supervisor `stop()`, fixed file-descriptor handling so processes do not leak on error paths
- **state-file-integrity** — reliable `writeState` with schema validation, atomic writes via temp-file rename, lock retries with backoff
