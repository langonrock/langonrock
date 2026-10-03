---
name: langonrock-implement
description: Implement or fix requested behavior in the langonrock compiler, store, retrieval, transports, CLI, or packaging.
---

# langonrock.workflow.implement

## Goal

Deliver the requested behavior with evidence that affected langonrock contracts
still hold.

## Scope

Applies to product code, tests, packaging, and the documentation needed for the
requested change. Deployment, release publication, and unrelated cleanup are
outside this workflow unless the user included them.

## Triggers

- Intent: add a feature, fix a bug, refactor a named component, change an API.
- Files: `src/`, `test/`, `scripts/`, `package.json`, runtime/tooling configuration,
  or `.github/workflows/` when implementation is requested.

## Inputs

- Requested behavior or specification and observable acceptance criteria.
- Diff scope and base branch, defaulting to `main` when a branch comparison is
  relevant. Inspect staged, unstaged, and untracked work separately.
- Affected public interfaces, persisted formats, and platform constraints.
- Existing package scripts, lint limits, TypeScript options, and test coverage
  settings from the [verification reference](../../reference/verification.md).

## Invariants

Apply the [engineering guidelines](../../reference/engineering-guidelines.md)
and [architecture invariants](../../reference/architecture.md#invariants).
Preserve unrelated work. A failing check is evidence to investigate; it is not
permission to widen the task or relax a threshold.

## Procedure

1. Inspect the working tree and state the requested result, assumptions, and
   checks. Account for every requirement in a supplied specification.
2. Use the architecture map to read the affected implementation, callers, and
   existing tests. Trace changes to shared types through embedded, remote,
   HTTP, CLI, and MCP consumers as applicable.
3. For a bug, reproduce the failure before fixing it. For new behavior, choose
   assertions that distinguish correct results from likely mistakes. Keep
   fixtures and temporary stores isolated from user data.
4. Make the smallest change that completes the request. Update public types,
   exports, protocol adapters, and usage docs only where the contract changed.
5. Run affected checks, fix failures caused by the change, and run the full CI
   checks for runtime or configuration changes. Use the documentation checks
   when the result changes prose only.
6. Inspect the final diff for unrelated edits and obsolete imports introduced
   by the change. Report the outcome and validation, including unresolved
   environmental or pre-existing failures.

## Outputs

- The implementation and meaningful regression coverage where behavior changed.
- Updated contract documentation where callers need it.
- Check results and a status for every requested requirement.

## Review gate

- [ ] Each requested behavior is implemented or explicitly reported incomplete.
- [ ] Affected storage, source, and transport invariants have supporting evidence.
- [ ] Applicable checks pass; any remaining failure is described accurately.
- [ ] The diff contains no unrelated cleanup or weakened quality limits.
- [ ] Documentation and HTML companions agree where the blueprint changed.

## References

- [Project entry](../../SKILL.md)
- [Architecture](../../reference/architecture.md)
- [Verification commands](../../reference/verification.md)
- [Interactive HTML view](README.html)
