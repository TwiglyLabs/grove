---
title: Concurrency Tests
status: not_started
description: >-
  Test parallel workspace creation, port allocation races, state file
  contention, and partial failure recovery
depends_on:
  - enhanced-pruning
  - setup-automation
tags:
  - chunked
not_started_at: '2026-02-21T02:02:31.318Z'
---

## Problem
Grove was built for single-user CLI usage. With Canopy driving parallel operations (multiple `workspace.create()` + `up()` calls simultaneously), we need confidence that state management, port allocation, and resource tracking don't break under concurrent access. No tests exist for this today.
## Approach
Write focused unit/integration tests that exercise concurrent paths with mocked infrastructure. Don't need real k8s — test the state layer:

- Port allocation under parallel requests
- State file read/write with locking
- Registry file contention
- Setup command failures during parallel provisioning
- Workspace creation races

Use `Promise.all()` patterns to simulate concurrent API calls.

**Two chunks:**
- **Chunk 1 (no dependencies):** Tests for port allocation, namespace uniqueness, state file locking, and registry contention. These exercise existing code.
- **Chunk 2 (after setup-automation + enhanced-pruning):** Tests for setup failure isolation and prune-during-up races. These require features that don't exist yet.
## Steps
### Chunk 1 — Current codebase (no dependencies)

1. Test: two `workspace.create()` calls via `Promise.all()` get unique port blocks — verify no overlap in allocated ranges
2. Test: parallel `workspace.create()` calls get unique namespace names — verify no collisions
3. Test: state file locking prevents corruption under concurrent writes — hammer `readState`/`writeState` in parallel, verify no data loss
4. Test: repo registry handles parallel auto-registration — two repos registering simultaneously don't corrupt the registry file

### Chunk 2 — After dependencies land

5. Test: setup failure in one workspace doesn't affect another — requires `setup-automation` to be implemented
6. Test: `prune()` during active `up()` doesn't destroy running environment — requires `enhanced-pruning` to be implemented
7. Fix any races discovered during testing
