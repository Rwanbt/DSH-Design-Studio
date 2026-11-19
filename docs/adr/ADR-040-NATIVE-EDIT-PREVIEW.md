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

## Binding application to the displayed result

CSS declaration edits (`css-rule`) also support preview. A review client can
send the returned `proposedHash` as `expectedProposedHash` to the typed
`/apply` endpoint. The Host rebuilds the patch from the typed request, checks
its resulting source hash, then delegates to the existing locked,
revision-checked write. A changed proposal is rejected even when the file
revision has not changed. A proposal hash is a content precondition. The
reviewing client is responsible for obtaining human approval and must never
delegate its apply operation to an agent.

## DSH agent proposal tool

When the DSH tool registry is available, the Host registers
`design_studio_propose`. The workspace comes from the runtime calling agent
and its working directory service. Arguments name a relative file and one
typed edit. Callers cannot supply a workspace, session identifier, raw patch
or replacement source. The tool reads through the native file store and
returns a bounded, versioned proposal with patch spans, revision tokens,
proposed content hash and the DSH call ID. It never writes to disk.

The tool and the editor use the same native planner and preview function.
The legacy file routes remain available when the optional tool service
is absent. The proposal's call ID is useful for display and correlation.
Authentic provenance and approval still require a review UI linked to the
DSH conversation and explicit application through the guarded editor.
