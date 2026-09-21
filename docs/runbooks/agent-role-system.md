# Working in langonrock

Use this runbook to enter a task without loading every workflow. The canonical
rules remain in the [project skill](../../skills/langonrock/SKILL.md) and
[engineering guidelines](../../skills/langonrock/reference/engineering-guidelines.md).

## Start a task

1. Read `AGENTS.md` and its mandatory engineering reference.
2. Inspect the working tree and state the requested outcome. Use `main` as the
   integration base unless the user selected another one.
3. Select one contract by intent. Use the architecture map to locate the
   implementation and the verification map to choose checks.

| Request                              | Route                   | First evidence                                                          |
| ------------------------------------ | ----------------------- | ----------------------------------------------------------------------- |
| Fix incorrect search passage offsets | `/langonrock implement` | `src/search/window.ts`, `test/window.test.ts`, and callers              |
| Review an HTTP source-editing diff   | `/langonrock review`    | Selected diff, conditional headers, grants, and connection parity tests |
| Update the source-editing guide      | `/langonrock document`  | `src/types.ts`, source routes, connection implementations, and CLI help |

These command forms describe routing conventions in the skill. They work as
instructions even when the agent client has no native subcommand support.

## Carry the work through

The [role contracts](../../skills/langonrock/reference/role-contracts.md) describe
responsibilities a single agent can perform in sequence. The router selects
scope. The implementer makes authorized changes. The reviewer checks the result.
The documenter updates affected explanations. Do not turn those responsibilities
into a required multi-agent process.

For a bug, reproduce it and add meaningful regression coverage. For a code
review, report concrete findings. For documentation, verify source claims,
links, and examples, then update matching HTML manuals.

## Verify and close

Follow the [verification reference](../../skills/langonrock/reference/verification.md)
for the selected scope. Record commands and outcomes, including checks that
could not run. A local run does not establish a pass on every CI platform.

For each requirement in a multi-feature request, state whether it is complete
and describe any remaining gap. Explain the resulting behavior and relevant
validation. Committing or publishing is a separate action unless it was part
of the user's request.

## Maintain the blueprint

Route updates through [document](../../skills/langonrock/workflows/document/SKILL.md).
Markdown is authoritative; HTML is a browsable rendering. Keep command names,
ids, manifest paths, root links, and the routing matrix synchronized. Keep the
project blueprint in tracked `skills/langonrock/`; the ignored `.agents/`
directory contains local tools and is not the shared project blueprint.

## References

- [Root instructions](../../AGENTS.md)
- [Project entry](../../skills/langonrock/SKILL.md)
- [Routing matrix](../../skills/langonrock/reference/routing-matrix.md)
- [Architecture](../../skills/langonrock/reference/architecture.md)
- [Verification](../../skills/langonrock/reference/verification.md)
- [Visual HTML version](agent-role-system.html)
