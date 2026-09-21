# Routing matrix

Select by requested outcome. File paths help locate the work; they do not
authorize edits or trigger unrelated workflows.

| Intent                                                                   | Typical files                                                                 | Command                 | Contract                                     |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ----------------------- | -------------------------------------------- |
| Implement native database ownership and performance gates                | `src/db/`, `native/`, `bench/dbms/`                                           | `/langonrock dbms`      | [DBMS](../workflows/dbms/SKILL.md)           |
| Add or fix compiler, storage, retrieval, API, CLI, or packaging behavior | `src/`, `test/`, `scripts/`, `.github/workflows/`                             | `/langonrock implement` | [Implement](../workflows/implement/SKILL.md) |
| Review a branch, commit, or local change                                 | The supplied diff and its callers/tests                                       | `/langonrock review`    | [Review](../workflows/review/SKILL.md)       |
| Explain or update documented behavior, navigation, or workflow contracts | `README.md`, `DESIGN.md`, `AGENTS.md`, `skills/langonrock/`, `docs/runbooks/` | `/langonrock document`  | [Document](../workflows/document/SKILL.md)   |

A mixed implementation request remains in `implement`; documentation and tests
belong to that change. A request for findings alone stays in `review`. Switch
to implementation when the user has asked for fixes, including fixes already
authorized in the same request.

The default integration branch is `main`. Select committed changes, staged
changes, unstaged changes, and untracked files deliberately using the
[diff procedure](verification.md#choose-the-diff). Do not treat a clean index as
proof that the working tree is clean.

## References

- [Project entry and command routing](../SKILL.md)
- [Command manifest](../template.json)
- [Role contracts](role-contracts.md)
- [Visual HTML version](routing-matrix.html)
