---
name: langonrock
description: Route implementation, review, and documentation tasks in the langonrock Bun/TypeScript knowledge store to repository-specific workflow contracts.
---

# langonrock

langonrock compiles Markdown bundles into deterministic, content-addressed tenant
snapshots. Its CLI, HTTP server, and MCP server share a read model and source
editing contract. Start with [architecture](reference/architecture.md) when
locating the code for a change.

## Orchestrator

1. Read the request and [engineering guidelines](reference/engineering-guidelines.md).
   Preserve the existing working tree. Identify the requested outcome and its
   verification before changing files.
2. Select one workflow from the table below. Load only that contract and the
   references relevant to the task. A question about the code can be answered
   from the architecture map without starting an implementation workflow.
3. Complete the selected contract's review gate. Report changed behavior, checks
   performed, unresolved failures, and any requirement still incomplete.

## Command routing

This is a router-only project skill. Interpret `/langonrock <cmd>` as an
instruction to load the matching file. If the client does not parse subcommands,
read the command from the user's message. These are repository conventions;
this blueprint does not register commands in any particular agent client.
There are no flat alias skills.

| Command                 | Load                                                         | Intent                                               |
| ----------------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| `/langonrock implement` | [workflows/implement/SKILL.md](workflows/implement/SKILL.md) | Add, fix, or refactor requested behavior             |
| `/langonrock review`    | [workflows/review/SKILL.md](workflows/review/SKILL.md)       | Inspect a diff and report concrete findings          |
| `/langonrock document`  | [workflows/document/SKILL.md](workflows/document/SKILL.md)   | Update docs and blueprint manuals from code evidence |

When no command is given, classify the requested outcome using the
[routing matrix](reference/routing-matrix.md). An unknown command is not a new
workflow; explain the available commands and use the user's stated intent when
it is clear.

## Project constraints

- Use Bun 1.3 or newer and TypeScript with explicit `.ts` imports. The store and
  server require Bun; the `langonrock/client` dependency graph must remain usable
  without Bun runtime APIs.
- Preserve snapshot determinism, tenant boundaries, source preconditions, and
  transport parity as specified in the [architecture invariants](reference/architecture.md#invariants).
- Keep Markdown source authoritative. A `.tnt` file contains the compiled read
  model and cannot recover the original frontmatter.
- Keep MCP stdout reserved for JSON-RPC. Retain the six existing tools unless
  the requested API change calls for a different contract.
- Follow the [verification map](reference/verification.md) for affected layers.
  Do not weaken lint, type, or coverage thresholds to pass a change.
- Default integration branch is `main`, as configured by CI and `origin/HEAD`.
  Use the user's requested base when supplied; inspect local refs before choosing
  a diff range. Do not switch branches just to inspect a change.

## References

- [Interactive HTML view](README.html)
- [Command manifest](template.json)
- [Routing matrix](reference/routing-matrix.md)
- [Role contracts](reference/role-contracts.md)
- [Engineering guidelines](reference/engineering-guidelines.md)
- [Architecture](reference/architecture.md)
- [Verification](reference/verification.md)
- [Agent runbook](../../docs/runbooks/agent-role-system.md)
