# ADR-040 — Revision-bound native edit preview

## Context

ADR-0002 requires manual and agent-initiated edits to share validation and
transaction semantics. The Host previously returned patch spans only after
committing. A reviewer needs those spans before deciding whether to apply.

## Decision

The Host provides `POST /design-studio-native/preview` for `html-text`,
`svg-text` and `svg-attribute`. It accepts the same typed arguments as their
existing `/apply` variants, including the normal session/workspace target and
both file revision tokens. It uses the same planner branches and native patch
validator. The response returns the patch spans, revision tokens, proposed
content hash and whether the edit changes the source. This response is JSON.
Consumers must render patch content as text.

Preview runs without file writes, model calls or approval state. Preview
rejects raw patches and source replacement. A subsequent apply is a separate
transaction that checks the file revision again under the existing write
lock. Identity can therefore change between preview and apply even when
content remains identical. Existing manual and undo endpoints keep their
contracts.

## Follow-up

An agent tool binding must constrain which session and file it can read.
Before wiring model-driven commits, the workbench needs a review surface
that handles live drafts, approval and provenance. The preview route alone
provides no model connection or agent write authority.
