# Role contracts

These are responsibilities within a task. One agent normally performs them in
sequence. They do not require separate agents or grant permission to delegate.

| Role        | Owns                                                            | Handoff evidence                                               | Boundary                                                         |
| ----------- | --------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------- |
| Router      | Identify intent, applicable rules, diff scope, and workflow     | Requested outcome, relevant files, selected contract           | Do not load every workflow or expand the task                    |
| Implementer | Make the authorized change and verify behavior                  | Diff, regression evidence, affected contracts, check results   | Preserve unrelated edits and public compatibility outside scope  |
| Reviewer    | Trace changed behavior through callers, storage, and transports | Findings with file locations, failure conditions, and impact   | A review request alone does not authorize fixes                  |
| Documenter  | Describe observed behavior and maintain navigation              | Source references, runnable examples, matching HTML companions | Do not turn design proposals into claims of implemented behavior |

## Handoffs

The router passes the request and constraints to the selected workflow. The
implementer checks the diff before closure and updates documentation when the
public behavior changed. A reviewer distinguishes a reproduced defect from a
question or untested risk. The documenter checks examples against the CLI,
exports, tests, and configuration.

End the task with the result, meaningful validation, and remaining gaps. For a
multi-feature specification, account for every item as required by the
[engineering guidelines](engineering-guidelines.md).

Committing, pushing, tagging, publishing releases, and messaging other people
are separate actions governed by the user's request. These role definitions
do not authorize them.

## References

- [Project entry](../SKILL.md)
- [Routing matrix](routing-matrix.md)
- [Agent runbook](../../../docs/runbooks/agent-role-system.md)
- [Visual HTML version](role-contracts.html)
