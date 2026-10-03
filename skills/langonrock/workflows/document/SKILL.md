---
name: langonrock-document
description: Update langonrock documentation and blueprint HTML companions using implementation, tests, and diff evidence.
---

# langonrock.workflow.document

## Goal

Keep project documentation accurate, navigable, and consistent with the code
and its executable commands.

## Scope

Applies to `README.md`, `DESIGN.md`, `AGENTS.md`, project skill contracts,
references, and runbooks. Code changes and external publication require their
own task scope. HTML companions are required for blueprint documents; this
workflow does not require converting every pre-existing project document.

## Triggers

- Intent: blueprint the project, document a feature, explain architecture,
  repair links, or update agent instructions.
- Files: Markdown, HTML manuals, and `skills/langonrock/template.json`.

## Inputs

- Requested documentation outcome and target readers.
- The implementation or diff being documented. Default branch comparison base
  is `main`; inspect local edits and untracked files when applicable.
- Source files, tests, CLI help, package scripts, and CI configuration that
  substantiate the documented behavior.
- Existing contracts, command manifest, and companion HTML pages.

## Invariants

Apply the [engineering guidelines](../../reference/engineering-guidelines.md).
Keep rules in one authoritative Markdown location and link to them. The project
entry and root instructions stay short. Treat `DESIGN.md` as rationale whose
claims need checking against current source.

## Procedure

1. Inspect the working tree and requested diff. Read the affected source and
   tests before writing claims. Distinguish present behavior from proposals.
2. Update the narrowest authoritative document. Preserve existing instructions
   when reorganizing them, and keep a mandatory link from `AGENTS.md`.
3. When routing changes, update the project entry, `template.json`, routing
   matrix, and root navigation together. Each command resolves to exactly one
   existing workflow; each workflow has all contract sections.
4. Generate an HTML companion for every changed blueprint Markdown source.
   Skills use `README.html`; other documents use their own base name. Place
   companions beside their source and link under `## References`.
5. Render the complete source into a single HTML file with Tailwind CDN, a dark
   `bg-zinc-950 text-zinc-100` default, translucent cards, method/status badges,
   code blocks, collapsible sections, and a theme toggle. Keep inline fallback
   styles so the document remains usable without the CDN. Map links to other
   blueprint documents to their HTML companions; keep a link to the source.
6. Run [blueprint maintenance checks](../../reference/verification.md#blueprint-maintenance-checks).
   Format only the touched documentation, verify links and fragments, and
   exercise any changed examples in an isolated local store. Check HTML
   navigation and controls at narrow and wide widths when presentation changed.
7. Inspect the final diff and report documents created or updated, validation,
   and any claim that could not be verified.

## Outputs

Updated Markdown, matching single-file HTML manuals, synchronized routing when
applicable, and evidence that links and documented commands work.

## Review gate

- [ ] Claims match implementation and tests; proposals are identified as such.
- [ ] Root instructions link to the canonical skill and preserved rules.
- [ ] Command manifest, routing table, ids, and workflow folders agree.
- [ ] All local links and anchors resolve.
- [ ] Each changed blueprint source links to a complete HTML companion.
- [ ] Formatting and relevant command examples pass.

## References

- [Project entry](../../SKILL.md)
- [Architecture](../../reference/architecture.md)
- [Verification commands](../../reference/verification.md)
- [Interactive HTML view](README.html)
