```json
{
  "verdict": "FAIL",
  "confidence": "HIGH",
  "key_insight": "The layer being proposed is already built and maintained by AWS at higher quality than a small team can sustain (agentcore-cli ships ready IAM policy JSON and an official aws-ia Terraform module), while the one real gap — multi-env promotion — is ops/CI config, not a library, and the one candidate that looks library-shaped — a portability shim — abstracts over compute models (microVM sessions, 8h lifetime ceiling, managed filesystem) that have no equivalent on ECS/Lambda and would either flatten to a useless lowest common denominator or cost 6-10 weeks with no validated need.",
  "findings": [
    {
      "severity": "critical",
      "category": "landscape",
      "id": "f-council-001",
      "description": "The packet's Terraform gap is overstated. An official AWS-org module, aws-ia/terraform-aws-agentcore, is published on the Terraform Registry and already provisions AgentCore runtimes, memories, gateways, and gateway targets, including automatic ARM64 container builds via CodeBuild and IAM role management. This is not a 'community workaround' — aws-ia is the same AWS organization that publishes canonical reference modules (VPC, EKS Blueprints, Landing Zone Accelerator).",
      "location": "https://github.com/aws-ia/terraform-aws-agentcore, https://registry.terraform.io/modules/aws-ia/agentcore/aws/latest",
      "recommendation": "If an org's IaC standard is Terraform, adopt this module rather than writing new HCL.",
      "fix": "Do not build a Terraform layer for langonrock. Point the team at aws-ia/terraform-aws-agentcore.",
      "why": "Building and then maintaining a competing Terraform module against a target that ships new resource types multiple times a week is a maintenance trap the org would own forever for a problem AWS already carries.",
      "ref": "https://github.com/aws-ia/terraform-aws-agentcore"
    },
    {
      "severity": "critical",
      "category": "engineering",
      "id": "f-council-002",
      "description": "agentcore-cli itself is pre-1.0. Its npm package is at 0.25.0 on main with a separate '1.0.0-preview.24' channel that has not reached GA. Commit history shows 5+ merged PRs in a single ~34-hour sampled window, including a schema/path fix, dependency-pin fix, and CI changes, on a repo created 2026-01-26 (about six months old) with 179 open issues. This is the actual moving target any wrapper would sit on top of.",
      "location": "github.com/aws/agentcore-cli commits, npm package @aws/agentcore",
      "recommendation": "Treat AgentCore-side churn, not LangChain-side churn, as the dominant maintenance risk.",
      "fix": "Do not commit engineering time to a wrapper until agentcore-cli reaches a stable 1.0, or budget for near-continuous (not occasional) upkeep.",
      "why": "A wrapper's entire job is tracking someone else's config schema and CLI flags (agentcore.json, aws-targets.json). At this commit velocity, drift accumulates faster than a small team can review it.",
      "ref": "https://github.com/aws/agentcore-cli"
    },
    {
      "severity": "significant",
      "category": "risk",
      "id": "f-council-003",
      "description": "The 'portability shim' candidate abstracts over compute models that are not equivalent. AgentCore Runtime gives each session its own microVM with an idleRuntimeSessionTimeout that resets per invoke AND a hard, non-resettable 8-hour maxLifetime ceiling, plus either 1GB/14-day managed session storage or BYO EFS/S3 mounted over NFSv4.1. Lambda has a 15-minute hard execution ceiling and no native long session concept; plain ECS has neither AgentCore's per-session isolation nor its lifecycle timers built in. A shim either flattens to the lowest common denominator (no persistent session state, no long sessions) or ends up as three near-independent implementations behind one interface.",
      "location": "docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-lifecycle-settings.html, runtime-persistent-filesystems.html",
      "recommendation": "Do not build a runtime-transparent abstraction. Keep the agent's own code framework-portable (LangGraph already is) and treat hosting-per-target as separate, small, target-specific deploy scripts.",
      "fix": "Drop the portability-shim candidate unless multi-cloud is an explicit, funded, near-term requirement — and even then, size it as three deploy paths, not one unified runtime.",
      "why": "This is speculative flexibility with no stated current need in the packet (the lock-in concern is hypothetical), which the project's own CLAUDE.md flags directly: no 'flexibility' that wasn't requested.",
      "ref": "https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-lifecycle-settings.html"
    },
    {
      "severity": "significant",
      "category": "engineering",
      "id": "f-council-004",
      "description": "IAM — the part of the 'internal golden path' most people assume is unsolved — is already solved by AWS. agentcore-cli ships three ready-to-use least-privilege policy documents (iam-policy-user.json, iam-policy-cfn-execution.json, iam-policy-boundary.json) plus a documented split between the developer's own narrow SDK-call policy and a separate CloudFormation execution role that CDK bootstrap manages. All that's needed is substituting ACCOUNT_ID and layering an org's own tag/boundary conventions on top.",
      "location": "github.com/aws/agentcore-cli docs/PERMISSIONS.md",
      "recommendation": "The internal golden path should copy and parameterize these JSON files, not write new IAM logic.",
      "fix": "Scope any 'golden path' work to templating existing AWS artifacts, not reimplementing IAM policy generation.",
      "why": "Reimplementing already-correct, AWS-maintained least-privilege policies is pure risk (a wrapper's IAM logic going stale is a security bug, not just a maintenance annoyance) for zero benefit over copying the file.",
      "ref": "https://github.com/aws/agentcore-cli/blob/main/docs/PERMISSIONS.md"
    },
    {
      "severity": "minor",
      "category": "landscape",
      "id": "f-council-005",
      "description": "The packet's EXPORT_NOTES.md concern is real but narrower than presented. That manual step belongs to the 'harness' declarative no-code path (`agentcore add harness` → `export harness`), which the CLI's own docs describe as exporting to 'a deployable Strands Python agent.' A hand-written LangChain/LangGraph agent uses `agentcore create --framework LangChain_LangGraph` directly and does not appear to go through the harness/export flow at all.",
      "location": "github.com/aws/agentcore-cli README.md, docs/frameworks.md",
      "recommendation": "Don't cite EXPORT_NOTES.md as evidence the LangChain deploy path specifically is manual/leaky — verify against the actual `agentcore create --framework LangChain_LangGraph` flow instead.",
      "fix": "Correct this in any downstream write-up.",
      "why": "Misattributing a Strands-no-code-path wrinkle to the LangChain path overstates the case for building a shim around LangChain deployment specifically.",
      "ref": "https://github.com/aws/agentcore-cli"
    },
    {
      "severity": "significant",
      "category": "adoption",
      "id": "f-council-006",
      "description": "The repo is empty and no agent has been deployed with agentcore-cli yet. The proposal is being evaluated before the cheap experiment (a day spent deploying the actual agent) has been run. Every LOC/weeks estimate in this analysis is necessarily speculative for the same reason the proposal itself is speculative.",
      "location": "/Users/henriquebreim/langonrock (empty except CLAUDE.md)",
      "recommendation": "Run the day-long experiment before writing any code.",
      "fix": "Block any 'build' decision on friction actually observed, not friction inferred from docs.",
      "why": "Building an abstraction layer before touching the tool you're abstracting is the exact failure mode this council should catch.",
      "ref": "council packet, recommendation_given"
    },
    {
      "severity": "minor",
      "category": "engineering",
      "id": "f-council-007",
      "description": "A deploy layer has an inherently weak CI story. The parts worth unit-testing (env-config templating, eval-gate threshold logic) are a small fraction of the surface; the parts that matter most (CDK synth output, CodeBuild image builds, ECR push, IAM role creation) are not economically unit-testable and need either golden-file assertions on generated config or a scheduled integration job against a disposable AWS sandbox account. Because agentcore-cli's own interface moves fast (f-council-002), a green test suite has a short shelf life unless a job re-validates against the latest published agentcore-cli release on a schedule — easy to skip, and drift then surfaces during a real deploy instead of in CI.",
      "location": "n/a — general to any deploy-layer wrapper",
      "recommendation": "If anything is built, keep owned logic to the templating/config layer only, exactly so the untestable surface stays as close to zero as possible.",
      "fix": "Pair any wrapper with a scheduled CI job pinned to `npm view @aws/agentcore version` that fails loudly on drift, rather than relying on developer-triggered tests alone.",
      "why": "Coverage on a wrapper's own glue code proves nothing about whether it still matches the CLI's current behavior; correctness here is relative to a third party's interface at a point in time.",
      "ref": "n/a"
    }
  ],
  "corrections_to_packet": [
    "Terraform: NOT merely 'coming soon' with only community workarounds. An official AWS-org module — aws-ia/terraform-aws-agentcore — is published on the Terraform Registry (registry.terraform.io/modules/aws-ia/agentcore/aws) and covers runtime/memory/gateway/gateway-target resources with automated ARM64 CodeBuild image builds and IAM role management. It is stale relative to agentcore-cli's newest surface (last pushed 2026-04-30 vs agentcore-cli's near-daily commits) so it does not yet cover evaluators, A/B tests, insights, payments, policy engines, or config bundles — but the core 'deploy an agent via Terraform' gap is materially smaller than the packet states. Source: https://github.com/aws-ia/terraform-aws-agentcore",
    "EXPORT_NOTES.md is scoped to the Strands-targeted 'export harness' no-code path, not the direct `agentcore create --framework LangChain_LangGraph` path used for a hand-written LangChain/LangGraph agent. The packet presents it as a general AgentCore CLI trait without that scoping. Source: github.com/aws/agentcore-cli README.md and docs/frameworks.md",
    "Addition, not in the packet at all: IAM is already solved with three ready-to-use least-privilege policy JSON files and a documented dev-credentials-vs-CFN-exec-role split, shipped in agentcore-cli's own docs/PERMISSIONS.md. This materially shrinks the 'internal golden path' candidate's scope — most of what that candidate would build already exists as copy-and-parameterize artifacts.",
    "Addition, not in the packet: agentcore-cli itself is pre-1.0 as of 2026-07-30 (main at 0.25.0, a '1.0.0-preview.24' channel not yet GA), with a very high commit/PR velocity. Meanwhile LangChain 1.x and LangGraph 1.x are independently confirmed GA since October 2025 with a stated no-breaking-changes-until-2.0 policy (docs.langchain.com/oss/python/release-policy). The version-treadmill risk in this proposal is heavily asymmetric: almost all of it sits on the AgentCore/agentcore-cli side, not the LangChain/LangGraph side, despite the packet framing it as risk from 'both ends.'"
  ],
  "conditional_branches": [
    {
      "condition": "Internal-only tool, single team, agent already exists in LangGraph, and the team has already spent the recommended day deploying it with agentcore-cli directly and hit specific, reproducible friction in environment promotion (not a hypothetical concern)",
      "verdict_under_condition": "WARN",
      "reasoning": "Build only the narrowest slice: a template repo (agentcore.json/aws-targets.json presets per env) + parameterized copies of AWS's own IAM policy JSON + a Makefile/CI YAML that shells out to `agentcore` commands. Roughly 300-500 LOC-equivalent, 3-5 days, low ongoing tax if it never reimplements CLI behavior."
    },
    {
      "condition": "Multi-cloud or provider portability is an explicit, funded, near-term business requirement rather than a hedge against hypothetical lock-in",
      "verdict_under_condition": "FAIL",
      "reasoning": "Still do not build a runtime-transparent shim — AgentCore's session/lifecycle/filesystem model has no equivalent primitive on ECS or Lambda, so unifying at that layer produces either a crippled lowest common denominator or three parallel implementations. If portability is truly required, keep the agent code framework-portable (already true for LangGraph) and write three separate, small, honest deploy paths instead of one abstraction that hides real differences."
    },
    {
      "condition": "The goal is an OSS project or product for outside users, not an internal tool",
      "verdict_under_condition": "FAIL",
      "reasoning": "This would mean competing directly, feature-for-feature, against an AWS-org-maintained CLI shipping multiple PRs a day. That is a maintenance race a small team loses; the effort-to-differentiation ratio is poor and worsens every release."
    },
    {
      "condition": "When actually tried, agentcore-cli's newer subsystems (`run eval`, `promote ab-test`, config bundles) turn out too undocumented or unstable to script a promotion gate against reliably",
      "verdict_under_condition": "WARN",
      "reasoning": "Fall back to a simpler multi-env pipeline that only depends on the stable `deploy`/`invoke`/`status` commands plus a manual approval gate, deferring eval-gated auto-promotion until those newer subsystems mature."
    }
  ],
  "recommendation": "Do not build langonrock as a layer or library. Spend the already-recommended day deploying the real agent end-to-end with `agentcore create --framework LangChain_LangGraph --model-provider Bedrock`, using the IAM policy JSON from agentcore-cli's own docs/PERMISSIONS.md verbatim. If Terraform is required by an existing IaC standard, adopt aws-ia/terraform-aws-agentcore instead of writing HCL. If real friction shows up in environment promotion, capture it as a template repo + Makefile + CI YAML that calls the `agentcore` CLI directly — never as a package that reimplements its logic. Revisit only if agentcore-cli reaches a stable 1.0 and a specific, validated gap still exists after that day of hands-on use.",
  "schema_version": 3
}
```

# Staff judge — engineering-reality analysis

## Verdict: FAIL (confidence HIGH)

The question this council was asked to judge is whether building a layer on top of LangChain/LangGraph to help deploy to AWS Bedrock is a good use of engineering time. Judged strictly on cost-to-build-and-maintain, the answer is no, for a reason stronger than the prior analysis identified: it isn't just that AWS occupies the space, it's that AWS occupies it with artifacts that are _already better than what a small team would ship in v1_ (ready least-privilege IAM policy JSON, an official Terraform module, generated Dockerfiles with sane defaults), while the one thing AWS's own tool is _not_ — stable — makes building anything durable on top of it a standing tax, not a one-time cost.

## Sizing the four candidate gaps

| Candidate                | Is it a real, open gap?                                                                                                                                                                             | Shape of the code                                                                                                             | Rough LOC (v1)                                                                                                                                           | Rough weeks (v1)          | Ongoing tax                                                                                                                                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Terraform**            | Mostly no — `aws-ia/terraform-aws-agentcore` already exists on the Terraform Registry, covering runtime/memory/gateway/gateway-target with automated ARM64 CodeBuild builds and IAM role management | HCL module                                                                                                                    | 2,000-4,000 LOC _only if_ extending it to cover evaluators/A-B-tests/payments/policy-engines/config-bundles, which the official module doesn't yet reach | 4-8 wks initial           | High — must track agentcore-cli's near-daily new resource types indefinitely                                                                                                                                                              |
| **Multi-env CI/CD**      | Yes — agentcore-cli is laptop-centric; no built-in dev/staging/prod promotion, secrets-per-env, rollback, or eval-gated promotion                                                                   | CI YAML + bash/Python glue calling the `agentcore` CLI directly; per-env config templating; eval-gate script                  | 300-800 LOC (mostly YAML/config, not "library" code)                                                                                                     | 1-2 wks                   | Low-moderate — coupled to `run eval` / `promote ab-test`, both recently added and less proven                                                                                                                                             |
| **Portability shim**     | No validated need stated anywhere in the packet — only a hypothetical lock-in concern                                                                                                               | An adapter/interface layer with per-target implementations (AgentCore / ECS / Lambda / local)                                 | 2,000-4,000+ LOC for even a two-target version                                                                                                           | 6-10 wks, then indefinite | Very high — the underlying compute models (microVM sessions with an 8h hard ceiling and managed filesystem vs. Lambda's 15-min ceiling vs. plain ECS with neither) are not equivalent, so the abstraction has nothing real to hide behind |
| **Internal golden path** | Yes, and the most defensible — but thinner than it looks once you see what AWS already ships                                                                                                        | Template repo (`agentcore.json`/`aws-targets.json` presets) + parameterized copies of AWS's own IAM policy JSON + Makefile/CI | 200-500 LOC-equivalent, almost all config                                                                                                                | 3-5 days                  | Low _if_ kept to templates that call the CLI; rises fast the moment it grows helper logic that reimplements CLI behavior                                                                                                                  |

The only candidate that survives contact with what actually exists is the golden path, and only as a template repo, not a library — which is exactly what the prior analysis guessed, but for a stronger reason than "internal tools are safer": most of the golden path's substance (IAM least-privilege split, container build defaults, CDK bootstrap) is not something to build at all, it's something to copy from `docs/PERMISSIONS.md` and `docs/container-builds.md` in agentcore-cli itself.

## The version treadmill, quantified

I pulled the actual commit history and package version rather than trusting the packet's framing of "both ends move."

- **LangChain 1.x / LangGraph 1.x**: GA since October 2025. Stated policy: no breaking changes until 2.0; minor releases are additive; deprecated features keep working with migration guidance and security patches through the entire 1.x line. Patch releases are frequent but non-breaking by policy. This side of the sandwich is genuinely calm.
- **agentcore-cli / AgentCore API**: The CLI is _pre-1.0_ as of today (main at `0.25.0`, with a `1.0.0-preview.24` channel that hasn't reached GA). The repo is six months old (created 2026-01-26), has 179 open issues, and in a single sampled ~34-hour window merged five PRs including a config-path fix and a dependency-compatibility fix — the kind of change that breaks a wrapper's assumptions about generated file layout or dependency pins. New capabilities (managed session storage, payments/x402, insights) have shipped in the last few months, meaning the CLI's own config schema and command surface are still actively growing.

So the "sits between two things that both move" framing in the packet is technically true but misleading by omission: essentially all the churn risk is on the AgentCore side. A wrapper here isn't hedging between two moderate risks, it's absorbing nearly all the risk of one immature, fast-shipping target while gaining almost nothing from the stable target underneath it.

## Where a wrapper would leak

- **IAM**: Already solved — AWS ships `iam-policy-user.json`, `iam-policy-cfn-execution.json`, and `iam-policy-boundary.json` with a documented split between the developer's narrow SDK-call policy and a separate CloudFormation execution role. A wrapper that reimplements this instead of parameterizing these files is pure downside: any drift is a security bug, not just an annoyance.
- **Container build**: Already solved — `agentcore create`/`add agent --build Container` generates a Dockerfile with layer caching, non-root user, OpenTelemetry instrumentation wired in, and auto-detects Docker/Podman/Finch locally; `deploy` builds remotely via CodeBuild so no local runtime is even required. Nothing here needs wrapping.
- **Streaming**: Local `agentcore dev --stream` and the production AgentCore Runtime invoke path are documented as separate code paths (dev server vs. per-session microVM streaming through HTTP/MCP/A2A on distinct ports 8080/8000/9000). A portability or convenience shim that conflates "streams locally" with "streams in production" is a classic silent-divergence leak.
- **Session lifecycle**: `idleRuntimeSessionTimeout` resets per invoke, but `maxLifetime` is a hard, non-resettable 8-hour ceiling per microVM. This is exactly the kind of foot-gun a wrapper needs to surface loudly, not abstract away — hide it and a team discovers it as a mysterious mid-conversation kill in production.
- **Cold start**: Split between platform-managed (microVM provisioning) and application-managed (dependency loading, agent construction). A wrapper can't fix the platform half and shouldn't hide the app half, since that's the part teams actually need to control to optimize it.
- **EXPORT_NOTES.md**: Real, but scoped to the Strands-targeted no-code "harness" export path, not the direct `agentcore create --framework LangChain_LangGraph` flow a hand-written LangChain agent would use. This is a correction to the packet, not a confirmation of its framing.

## Testing and CI for a deploy layer

The honestly-testable surface of any such layer is small: env-config templating and eval-gate threshold logic are pure functions and should get real unit tests with mutation-style assertions (a `>=` flipped to `>`, a threshold off by one). Everything downstream of that — CDK synth output, CodeBuild image builds, ECR pushes, IAM role creation — is not economically unit-testable; the realistic options are golden-file assertions on generated config plus a scheduled integration run against a disposable AWS sandbox account. Given the CLI's commit velocity (f-council-002), a green suite today says little about next week — the only test that actually protects you is a scheduled job that re-runs against the latest published `agentcore-cli` release and fails loudly on drift, which is easy to skip and therefore easy to let rot. This is itself an argument for owning as little logic as possible: the less code there is, the less there is to go stale silently.

## The thinnest artifact that solves the real problem

Ranked thin to thick: a README recipe (near-zero cost, arguably not "built"); a Makefile with a handful of targets wrapping `agentcore` invocations (thin, shell-testable, matches the golden-path candidate); a template repository combining `agentcore create` output with pre-filled IAM policy JSON and CI YAML (what the prior analysis correctly favored); a CDK construct (not warranted — agentcore-cli already owns CDK, and reuse beats a new construct); a full library (nothing found in this research justifies one — there is no gap that requires a persistent, independently-versioned runtime abstraction). CLAUDE.md's own bias toward minimum code per feature and no speculative abstraction points at the same answer the engineering-cost analysis does: templates and CI config, not code.

## IMPLEMENTATION_COST

**IMPLEMENTATION_COST: ~3-5 days for the only defensible slice** (a template repo + Makefile + CI YAML wrapping agentcore-cli directly and reusing AWS's own IAM policy JSON, roughly 300-500 LOC-equivalent of config). The other three candidates are either already solved upstream (Terraform: adopt `aws-ia/terraform-aws-agentcore`), represent 6-10+ weeks of speculative, continuously-draining maintenance against a target that has no validated need (portability shim), or are 1-2 weeks of legitimate but non-library ops work (multi-env CI/CD, sized as pipeline config, not a package). **Main uncertainty**: whether agentcore-cli's newer subsystems — `run eval`, `promote ab-test`, config bundles — are mature and documented enough today to script a reliable eval-gated promotion pipeline against; these are recently added (the commit history shows active churn across the whole CLI) and were not independently load-tested in this research. If they turn out half-baked, the multi-env slice should fall back to a simpler deploy-plus-manual-gate pipeline until they stabilize, which is the one thing that could push the estimate up rather than down.
