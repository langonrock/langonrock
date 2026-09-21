---
name: langonrock-review
description: Review a langonrock diff for concrete correctness, compatibility, and maintainability problems.
---

# langonrock.workflow.review

## Goal

Identify actionable defects in the requested diff and explain their impact with
source evidence.

## Scope

Applies to requested code or documentation review. Inspect unchanged callers
and tests when needed to assess a change. Apply fixes only when the user has
authorized them, using the implementation workflow for the resulting edits.

## Triggers

- Intent: review a branch, inspect a patch, check a change for regressions.
- Files: the supplied diff, affected callers, tests, and configuration.

## Inputs

- The requested review target and expected behavior.
- Base branch, normally `main`, or an explicit commit/range. Include local work
  only when it belongs to the review scope.
- Current source, relevant tests, and quality configuration from
  [verification](../../reference/verification.md).

## Invariants

Apply the [engineering guidelines](../../reference/engineering-guidelines.md).
Report concrete failure conditions rather than preferences. Distinguish
introduced defects from pre-existing issues. Preserve the user's working tree
during a review that asks for findings only.

## Procedure

1. Establish the diff with the [diff procedure](../../reference/verification.md#choose-the-diff).
   Read changed files in context and identify the contracts they affect.
2. Trace data and dependencies across the relevant modules. Use
   [architecture invariants](../../reference/architecture.md#invariants) to check
   determinism, snapshot publication, source hashes, tenant scope, and transport
   behavior where applicable.
3. Inspect tests for assertions that would fail under a plausible defect. Run a
   focused reproduction or existing check when it resolves a concrete doubt.
4. Check complexity, module cohesion, and dependency direction against existing
   limits. Tie maintainability findings to the changed code and its cost.
5. Report findings in severity order, with file/line, triggering condition,
   consequence, and suggested correction. If no defects are found, say so and
   state the scope and validation limits.

## Outputs

A review report with actionable findings or an explicit no-findings result,
plus checks performed and unverified risks relevant to the diff.

## Review gate

- [ ] Findings refer to the selected diff and a credible failure condition.
- [ ] Claims of behavior have code or test evidence.
- [ ] Relevant compatibility and platform boundaries were examined.
- [ ] The report distinguishes defects, open questions, and checks not run.
- [ ] No unauthorized edits or external actions were performed.

## References

- [Project entry](../../SKILL.md)
- [Architecture](../../reference/architecture.md)
- [Verification commands](../../reference/verification.md)
- [Implementation workflow](../implement/SKILL.md)
- [Interactive HTML view](README.html)
