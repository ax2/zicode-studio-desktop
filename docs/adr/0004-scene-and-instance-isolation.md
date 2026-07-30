# ADR 0004: Separate scene profiles from runtime instances

- Status: Accepted
- Date: 2026-07-30

## Context

The inherited runtime model isolates Pi processes by session, but all processes still resolve the
same user-level Pi configuration, credentials, extensions, packages, and trust records. The product
must support programming, finance, writing, and user-defined scenes with different models, prompts,
tools, network permissions, and data boundaries.

## Decision

A `SceneProfile` is reusable policy and configuration. A `RuntimeInstance` is one live or resumable
execution. Each instance owns one Pi process and isolated session, log, and temporary directories.
Each scene owns an isolated Pi agent directory selected through `PI_CODING_AGENT_DIR`.

Runtime identifiers are never used as raw path components. The Rust Host derives stable filesystem
keys from their SHA-256 digests and verifies that canonical paths remain under the application data
root.

Credentials remain outside scene and instance JSON. Scene provider settings contain credential
references resolved by a Windows credential broker. Sharing a credential across scenes requires an
explicit provider assignment.

Scene policy is enforced by the Rust Host before a request reaches Pi. Filesystem directory
separation is not treated as an operating-system sandbox.

## Consequences

- Existing clients without a scene ID use the built-in programming scene during migration.
- Switching scenes starts a new runtime; a live process never changes its scene identity.
- Pi packages and extensions are scene-scoped by default.
- Finance and other restricted scenes can disable shell access regardless of prompt content.
- Migration must move or reference existing global Picot data without silently mixing it into every
  scene.

