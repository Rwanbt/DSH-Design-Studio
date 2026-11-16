# ADR-0002 — Manual and agent edits use one transaction model

**Status:** Accepted (architecture direction) — 2026-11-16.

## Decision

UI manipulations and agent tooling call a common validated command executor, with `document_id`, `base_revision`, command payload, affected source spans, author type (human/agent), inverse operation and result revision.

Commands are validated before writes. Disk updates use atomic replacement or a safe equivalent. Stale writes are rejected or reconciled via an explicit conflict UI. History is persisted independently from source content.

## Non-negotiable behavior

- Manual commands and undo/redo do not call an AI model, telemetry endpoint or cloud service.
- Agent edits never bypass validation or replace unsaved manual work.
- File watcher updates invalidate stale source mappings before edits.
- Edits to unsupported/ambiguous content fail safely.
- Record tests for races, interrupted saves, undo/redo across reopen, symlink/path traversal and external modifications.
