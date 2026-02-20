---
title: 'Foundation: Directory Structure, Shared Infra, Commander Skeleton'
status: draft
description: >-
  Set up vertical slice directory layout, shared infrastructure, config
  compositor pattern, and commander CLI skeleton
tags:
  - foundation
  - architecture
---

## Problem

Grove's `src/` is a flat mix of 15+ files with no domain boundaries. Config, state, output helpers, identity types, error classes, and business logic all live at the same level. The CLI entry point is a hand-rolled switch statement with inline arg parsing. There's no structural convention for where new code should go, making it hard to navigate or extend reliably.

Before migrating any domain into a vertical slice, we need the target structure in place: directories, shared infrastructure extracted, and a commander-based CLI skeleton that slices can register into.

## Approach

**Phase 1 — Directory scaffolding.** Create the slice directories: `src/repo/`, `src/workspace/`, `src/environment/`, `src/testing/`, `src/shell/`, `src/logs/`, `src/simulator/`, `src/request/`. Create `src/shared/` for cross-cutting infrastructure. Directories are empty initially — no code moves yet.

**Phase 2 — Extract shared infrastructure to `src/shared/`.** Move identity types (`RepoId`, `WorkspaceId`, branded type helpers) to `src/shared/identity.ts`. Move base error classes (`GroveError` and subclasses) to `src/shared/errors.ts`. Move output/formatting helpers (chalk wrappers) to `src/shared/output.ts`. Update all existing imports to point at new locations. Tests must still pass after this move.

**Phase 3 — Config compositor pattern.** Refactor `src/config.ts` into a thin root parser. The root config file reads `.grove.yaml`, validates the top-level structure, and delegates each section to domain-owned schema fragments. Initially the schema fragments stay inline (they'll move into slices in later plans), but the *pattern* is established: each domain will export a zod schema, and the root config composes them.

**Phase 4 — Commander CLI skeleton.** Add `commander` as a dependency. Create `src/cli.ts` that sets up the top-level `program` with version, description, and global options. Refactor `src/index.ts` to use the commander program instead of the switch statement. Each command is registered via `program.command(...)` — initially wiring to the existing command functions. The hand-rolled arg parsing in each command file stays for now (slices will own their own commander subcommands when migrated).

**Phase 5 — CLAUDE.md.** Write the project's CLAUDE.md documenting the vertical slice architecture, development commands, testing approach, and the convention for adding new slices.

No behavioral changes. All 535 tests pass throughout. This is pure structural scaffolding.
