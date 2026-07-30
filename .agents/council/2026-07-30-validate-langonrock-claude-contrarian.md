```json
{
  "verdict": "WARN",
  "confidence": "MEDIUM",
  "key_insight": "agentcore-cli is not the settled, mature standard the prior analysis implies — it is a 6-month-old preview-tagged CLI with verified, currently-open, production-grade bugs (an account-wide OAuth2 quota leak, a silently-ignored custom-IAM-role flag, undisclosed CloudWatch cost inflation, and a buggy multi-target deploy) — which justifies building a narrow, evidence-backed golden-path/guardrail shim, but not a generic competing deploy tool.",
  "findings": [
    {
      "severity": "critical",
      "category": "risk",
      "id": "f-council-101",
      "description": "agentcore-cli has an open, verified bug where `agentcore deploy` registers a managed OAuth2 credential provider outside the CloudFormation stack whenever a CUSTOM_JWT harness or OAuth-outbound gateway is used, and `agentcore remove all` never deletes it. AWS accounts are capped at 50 OAuth2 credential providers account-wide; repeated create/teardown cycles (normal in dev, or across CI, or across multiple projects sharing an account) silently accumulate orphans until every subsequent CUSTOM_JWT/OAuth deploy in the account fails.",
      "location": "https://github.com/aws/agentcore-cli/issues/1673",
      "recommendation": "If the agent uses CUSTOM_JWT auth or OAuth-outbound gateways, do not rely on agentcore-cli's teardown to be safe. Track/clean up OAuth2 credential providers separately.",
      "fix": "Build a thin post-teardown hook (a few dozen lines) that lists and deletes orphaned OAuth2 credential providers via `bedrock-agentcore-control` after `agentcore remove`, or avoid CUSTOM_JWT-based teardown/redeploy cycles in CI until AWS closes this issue.",
      "why": "This is not a rough edge, it's a quota-exhaustion landmine that can brick unrelated deploys in the same account weeks after the fact, and it is exactly the kind of operational-safety gap a thin internal wrapper is well suited to close cheaply.",
      "ref": "https://github.com/aws/agentcore-cli/issues/1673"
    },
    {
      "severity": "critical",
      "category": "adoption",
      "id": "f-council-102",
      "description": "agentcore-cli has no way to specify a custom/pre-existing IAM execution role for a runtime. The underlying AWS API supports --role-arn, but the CLI always auto-creates its own CDK-managed role. Manually adding a roleArn field to agentcore.json passes `agentcore validate` with no warning and is then silently ignored at deploy time — the CLI deploys with its own role anyway.",
      "location": "https://github.com/aws/agentcore-cli/issues/870",
      "recommendation": "Any organization with a least-privilege / pre-approved-IAM-role policy (common in regulated or security-conscious shops) cannot use agentcore-cli as-is today without violating that policy or accepting CLI-generated roles.",
      "fix": "If this constraint applies, either wait for AWS to ship the fix, or build a deploy-time validation step that fails closed (blocks deploy) if agentcore.json's roleArn does not match what was actually assigned post-deploy, since the tool will not warn you.",
      "why": "A silent no-op on a security-relevant field is a worse failure mode than an explicit error — teams can believe they've enforced least privilege when they have not.",
      "ref": "https://github.com/aws/agentcore-cli/issues/870"
    },
    {
      "severity": "significant",
      "category": "risk",
      "id": "f-council-103",
      "description": "AgentCore Observability, enabled by default via agentcore-cli, routes X-Ray spans through CloudWatch Application Signals, which auto-generates metric time series for every API call x 4 metric names (Latency, Error, Fault, Throttle). This is billed per-metric-per-month and there is no documented, supported way to disable the metric explosion while keeping tracing; only an unofficial IAM-permission workaround exists.",
      "location": "https://github.com/aws/agentcore-cli/issues/1472",
      "recommendation": "Do not assume agentcore-cli's default observability setup is cost-neutral. For agents that call many distinct AWS APIs, budget for CloudWatch Application Signals metric costs or apply the documented workaround.",
      "fix": "If cost visibility is a stated goal for internal tooling, a small pre-deploy cost estimator or default-suppression flag closes a real, currently-undisclosed gap.",
      "why": "Undisclosed, usage-scaling cost is exactly the kind of thing a 'golden path' wrapper exists to prevent teams from discovering via a surprise bill.",
      "ref": "https://github.com/aws/agentcore-cli/issues/1472"
    },
    {
      "severity": "significant",
      "category": "landscape",
      "id": "f-council-104",
      "description": "Corrects the packet: agentcore-cli already shipped multi-environment deploy (PR/issue #1186, 'feat: multi-environment-deploy', closed) — the packet's framing of the tool as purely 'developer-laptop-centric' with no promotion support is stale. However, multi-target deploy is currently buggy: `deploy --target <name>` describes CloudFormation stacks for ALL configured targets instead of just the one being deployed (open issue #1735), and the CDKToolkit bootstrap-stack name is hard-coded, causing false 'not bootstrapped' prompts across targets/accounts (open issue #1799).",
      "location": "https://github.com/aws/agentcore-cli/issues/1735, https://github.com/aws/agentcore-cli/issues/1799, https://github.com/aws/agentcore-cli/issues/1186",
      "recommendation": "The real gap is not 'no multi-env promotion' (false) — it's 'immature multi-env promotion' (true, and narrower). Re-scope any 'multi-env' candidate gap accordingly.",
      "fix": "If multi-env promotion is a near-term need, either wait a few release cycles (this repo closes issues fast — see f-council-105) or build a very thin wrapper that shells out to `agentcore deploy --target` per-environment sequentially rather than trusting its native multi-target mode today.",
      "why": "Recommending work against a gap that's already half-closed wastes effort; the packet should have verified this before listing it as a candidate.",
      "ref": "https://github.com/aws/agentcore-cli/issues/1186"
    },
    {
      "severity": "significant",
      "category": "landscape",
      "id": "f-council-105",
      "description": "agentcore-cli is young and still preview-versioned, not a settled standard. Repo created 2026-01-26 (six months old as of today). As of 2026-07-28 (two days before this analysis), the npm package's own release stream is tagged 'v1.0.0-preview.24 (Preview)' released alongside 'v0.25.0' — i.e., the tool has not reached a stable 1.0. It has 232 stars, 63 forks, and 179 open issues against ~405 already-closed issues/PRs — a very high issue-to-star ratio and high churn rate for a 6-month-old repo, consistent with both 'moving fast' and 'still finding its rough edges.'",
      "location": "https://github.com/aws/agentcore-cli",
      "recommendation": "Treat agentcore-cli as an actively-forming tool, not a finished one. Betting a production deploy pipeline entirely on it today carries real API/behavior-churn risk, separate from whether it's 'good.'",
      "fix": "Pin the CLI version explicitly in any tooling built on top of it, and budget time to re-validate assumptions every few releases rather than treating today's behavior as permanent.",
      "why": "The packet's tone implies a mature, de-facto-standard tool; the version history contradicts that.",
      "ref": "https://github.com/aws/agentcore-cli/releases"
    },
    {
      "severity": "significant",
      "category": "strategy",
      "id": "f-council-106",
      "description": "AWS has a recent, concrete track record of churning through opinionated deployment CLIs in adjacent spaces: AWS Copilot CLI (ECS/Fargate deploy CLI) reaches end-of-support on 2026-06-12, with AWS's own guidance pointing users to either raw primitives (Terraform, CDK L3) or a new AWS offering (ECS Express Mode) — not to a stable, durable Copilot. Separately, in this exact same problem space, bedrock-agentcore-starter-toolkit was already declared legacy in favor of agentcore-cli within roughly a year of its own existence.",
      "location": "https://aws.amazon.com/blogs/containers/announcing-the-end-of-support-for-the-aws-copilot-cli, https://github.com/aws/bedrock-agentcore-starter-toolkit",
      "recommendation": "'AWS ships it, so don't bother' is not automatically a safe bet — AWS has, twice in the recent past (Copilot; starter-toolkit->agentcore-cli), built and then abandoned or superseded its own opinionated deploy-experience layer for this category. Betting entirely on agentcore-cli carries a real replatforming risk of the same kind the packet worries about for a homegrown tool.",
      "fix": "Do not deeply hard-wire irreversible logic to agentcore-cli-specific config formats; keep the actual agent code framework-native (LangGraph) so a future CLI swap is a packaging change, not a rewrite.",
      "why": "This is the single most direct rebuttal to the packet's 'both ends of the bridge are occupied, so don't build' framing: occupation by AWS has not historically meant permanence in this category.",
      "ref": "https://aws.amazon.com/blogs/containers/announcing-the-end-of-support-for-the-aws-copilot-cli"
    },
    {
      "severity": "minor",
      "category": "landscape",
      "id": "f-council-107",
      "description": "Corrects the packet's Terraform framing: Terraform support for AgentCore is not simply absent-with-nothing-today. aws-ia/terraform-aws-agentcore (aws-ia = AWS Integration & Automation, an AWS-affiliated org) already ships a Terraform module covering runtimes (CODE and CONTAINER types), endpoints, memory, gateways, browser, and code-interpreter resources. It is small (24 stars, 116 commits) and its documentation does not mention LangChain/LangGraph packaging specifically.",
      "location": "https://github.com/aws-ia/terraform-aws-agentcore",
      "recommendation": "The real Terraform gap is narrower than 'Terraform support coming soon': it's that the Terraform path (aws-ia module) and the LangChain/LangGraph packaging path (agentcore-cli) are two disconnected AWS-official tools that have not converged. The missing piece is a thin adapter that packages a LangGraph agent (container image + entrypoint contract) in the shape terraform-aws-agentcore's runtime resource expects.",
      "fix": "If Terraform is a hard organizational requirement, the buildable unit is small: a Dockerfile/entrypoint template that produces a AgentCore-compatible container from a LangGraph app, consumed by the existing Terraform module — not a new Terraform provider from scratch.",
      "why": "This is a much smaller, more defensible slice than 'build Terraform support for AgentCore.'",
      "ref": "https://github.com/aws-ia/terraform-aws-agentcore"
    },
    {
      "severity": "minor",
      "category": "adoption",
      "id": "f-council-108",
      "description": "agentcore-cli's `create` wizard is greenfield-oriented (scaffolds a new project). Multiple currently-open issues (#1726, no way to modify an existing agent's config, e.g. add an authorizer after creation post-hoc) and the pattern in AWS's own published samples (awslabs/amazon-bedrock-agentcore-samples, aws-samples/langgraph-agents-with-amazon-bedrock) show that taking an EXISTING LangGraph agent to AgentCore today is a manual recipe: import BedrockAgentCoreApp, wrap it with an @entrypoint, containerize, update .bedrock_agentcore.yaml, then `cdk deploy` — not a one-command 'wrap my existing repo' flow.",
      "location": "https://github.com/aws/agentcore-cli/issues/1726, https://github.com/awslabs/amazon-bedrock-agentcore-samples",
      "recommendation": "The user's own framing ('the agent', singular, definite) implies an existing agent, not a new one. This brownfield-onboarding gap is closer to the user's literal ask than generic 'deploy tooling' is.",
      "fix": "If the agent already exists in LangGraph, the highest-leverage small deliverable is a single wrapper script/template that mechanically applies the AWS-documented BedrockAgentCoreApp pattern to the existing repo, not a general-purpose deploy competitor.",
      "why": "This reframes 'build a deploy layer' into a much smaller, one-time-cost 'convert this specific repo' task, which may not need to be a reusable tool at all.",
      "ref": "https://github.com/awslabs/amazon-bedrock-agentcore-samples/blob/main/03-integrations/agentic-frameworks/langgraph/README.md"
    }
  ],
  "corrections_to_packet": [
    "agentcore-cli is not a mature/settled standard: repo created 2026-01-26 (6 months old), and its own npm release is currently versioned 'v1.0.0-preview.24 (Preview)' as of 2026-07-28. The packet's tone treats it as a finished product; it is closer to an actively-forming one. Source: https://github.com/aws/agentcore-cli/releases",
    "The packet's claim that agentcore-cli is 'developer-laptop-centric' with no multi-env promotion is stale: multi-environment deploy already shipped (closed issue/PR #1186), though it currently has correctness bugs in target-scoping (#1735) and bootstrap-stack detection (#1799). Source: https://github.com/aws/agentcore-cli/issues/1186, /1735, /1799",
    "The packet's Terraform framing ('coming soon,' real gap today) undersells what exists: an official AWS-affiliated Terraform module (aws-ia/terraform-aws-agentcore) already covers AgentCore runtimes, memory, gateways, browser, and code interpreter — it's just small, and doesn't document LangChain/LangGraph packaging specifically, which is the actual narrow gap. Source: https://github.com/aws-ia/terraform-aws-agentcore",
    "The packet did not surface that agentcore-cli has several currently-open, production-grade bugs that go beyond normal rough edges: an OAuth2 credential-provider leak that exhausts a 50-provider account-wide quota (#1673), a silently-ignored custom-IAM-role override (#870), and undisclosed CloudWatch metric cost inflation from default observability (#1472). These materially change the risk calculus of 'just adopt agentcore-cli as-is.'"
  ],
  "conditional_branches": [
    {
      "condition": "Internal tool, for one team, for an agent that already exists in LangGraph, with no stated multi-cloud requirement",
      "verdict_under_condition": "WARN",
      "reasoning": "Build a narrow (1-3 day) golden-path/guardrail shim around agentcore-cli that specifically closes the five verified gaps found above: enforce/validate custom IAM role usage (f-council-102), clean up orphaned OAuth2 credential providers on teardown (f-council-101), default-suppress or surface the CloudWatch Application Signals cost path (f-council-103), translate opaque CDK/container-build errors (see prior analysis's own error-message note), and template the brownfield 'wrap my existing LangGraph agent' pattern (f-council-108). This is not a deploy-tool rewrite — it is a thin, evidence-backed safety layer over a real, currently-buggy tool. Do not attempt to reimplement create/dev/deploy/invoke, containerization, ECR, or IAM policy generation — that's already well-covered and actively maintained."
    },
    {
      "condition": "Org has a genuine, already-decided (not hypothetical) multi-cloud requirement",
      "verdict_under_condition": "PASS",
      "reasoning": "This is the one condition under which the Terraform/SST/Serverless-Framework precedent actually transfers: those tools won specifically because they served a cross-cloud need AWS's own tooling structurally cannot serve. If true, start with the narrow adapter in f-council-107 (package a LangGraph agent for the existing aws-ia Terraform module) rather than a full portability abstraction from day one — and budget it as a multi-quarter investment, not a sprint, per SST's own experience needing a full rewrite (CDK to Pulumi) to get this right (https://sst.dev/blog/moving-away-from-cdk/)."
    },
    {
      "condition": "Proposal is intended as an OSS project or product for external users, not an internal tool",
      "verdict_under_condition": "FAIL",
      "reasoning": "None of the conditions that let third-party layers beat first-party AWS tooling historically (first-mover timing, as with Serverless Framework arriving before SAM; a genuine multi-cloud need, as with Terraform; or years of dedicated team investment, as with SST's full CDK-to-Pulumi rewrite) are present here. agentcore-cli ships ~50+ merged changes a month with an AWS team actively closing exactly the issues found in this review. A side project cannot outpace that cadence, and the market outcome (Copilot CLI's own end-of-support, https://aws.amazon.com/blogs/containers/announcing-the-end-of-support-for-the-aws-copilot-cli) shows even AWS's own opinionated CLIs in this category struggle to stay relevant without a committed multi-year team."
    },
    {
      "condition": "Team is a single engineer whose real deliverable is shipping the agent, not shipping tooling",
      "verdict_under_condition": "FAIL",
      "reasoning": "Even the narrow guardrail shim is a distraction. Deploy with agentcore-cli as-is, apply the documented workarounds for the known issues (e.g., the IAM-permission workaround for f-council-103) manually, and track the upstream issue numbers rather than building anything."
    }
  ],
  "recommendation": "Do not build a generic 'deploy LangChain agents to Bedrock' layer — agentcore-cli already covers that surface and is being actively developed. Do spend half a day reproducing the five verified issues above (#1673, #870, #1472, #1735, #1799) against the actual agent before deciding anything further; if any of them block a real requirement (compliance-mandated IAM roles, CUSTOM_JWT auth, cost predictability), build only the specific guardrail that closes that gap, sized in days not weeks, and revisit in one quarter since this repo closes issues fast enough that today's gaps may already be gone.",
  "schema_version": 3
}
```

# Contrarian Analysis: The Steel-Man Case for Building

## Mandate

My job on this council is not to be contrarian for its own sake — it's to build the strongest **honest** case for building `langonrock`, attack the skeptical position where it's weak, and say plainly if that case doesn't hold up. After independently verifying the landscape (GitHub issues via `gh api`, release history, precedent case studies, and cross-checking the packet's claims), I found real, current, verifiable weaknesses in `agentcore-cli` that the prior analysis did not surface — but I also found that most of them argue for a _narrow_ build, not the generic one the user's question literally asks about. My verdict is **WARN**, not PASS, and I explain why below rather than reaching for a PASS the evidence doesn't fully support.

## Where the skeptical position is weak

### 1. "AWS already ships it" treats agentcore-cli as more mature than it is

I checked the repo directly:

```
created_at: 2026-01-26   (6 months old)
stargazers: 232          forks: 63
open_issues: 179         closed issues+PRs: ~405
latest releases (2026-07-28): "v1.0.0-preview.24 (Preview)" AND "v0.25.0" simultaneously
```

Source: https://github.com/aws/agentcore-cli

This is a six-month-old tool whose own npm release stream is still tagged **preview** two days before the date of this analysis. The prior analysis's tone ("exactly the thing you would build," implicitly settled) doesn't convey that. A 179-open-issue count against 232 stars is a very high ratio for a 6-month-old repo — consistent with AWS moving fast, but also consistent with a tool still finding its footing. Both readings are legitimate; the packet only offered the first.

### 2. Verified, currently-open bugs are not hypothetical friction — some are genuinely dangerous

I pulled the actual issue bodies, not just titles. Four stand out as materially different in kind from "rough edges":

- **Account-wide quota exhaustion** (https://github.com/aws/agentcore-cli/issues/1673): `agentcore deploy` creates an OAuth2 credential provider for CUSTOM_JWT/OAuth harnesses _outside_ the CloudFormation stack, and `agentcore remove all` never deletes it. AWS accounts cap OAuth2 credential providers at 50 (quota `L-431051DC`). Normal dev iteration (create/deploy/teardown, or shared CI accounts) silently accumulates orphans until **every** subsequent OAuth-based deploy in the account fails — not just the project that leaked them. This is a landmine that surfaces as a confusing outage weeks after the fact, in a component (auth) most teams would assume the vendor CLI gets right.
- **Silently-ignored security control** (https://github.com/aws/agentcore-cli/issues/870): there is no flag to use a pre-existing IAM execution role. Worse, if you hand-edit `agentcore.json` to add one, `agentcore validate` passes with no warning, and `deploy` silently uses its own auto-generated role anyway. For any org with a least-privilege / pre-approved-roles policy, this isn't a missing feature, it's a tool that will quietly violate the policy while looking like it complied.
- **Undisclosed cost scaling** (https://github.com/aws/agentcore-cli/issues/1472): default observability routes X-Ray spans through CloudWatch Application Signals, which auto-generates 4 metrics per distinct AWS API call the agent makes. There's no documented, supported way to turn this off while keeping tracing.
- **A live bug in exactly the gap the packet flagged**: the packet says agentcore-cli lacks multi-env promotion. I found that's stale — multi-environment deploy already shipped (closed #1186) — but it's currently buggy: `deploy --target <name>` describes CloudFormation stacks for _all_ targets, not just the one being deployed (https://github.com/aws/agentcore-cli/issues/1735), and the CDKToolkit bootstrap-stack name is hard-coded, causing false bootstrap prompts across accounts/targets (https://github.com/aws/agentcore-cli/issues/1799).

None of this makes agentcore-cli bad — it makes it a real, imperfect, actively-worked-on tool, which is a different fact than "the layer already exists, fully occupied." The honest framing is: the layer exists, and it currently has holes big enough that a thin safety wrapper over it is defensible engineering time.

### 3. "AWS owns both ends of the bridge" ignores AWS's own churn in this exact category

AWS Copilot CLI — an earlier opinionated AWS deploy-CLI for ECS/Fargate — reaches **end of support on 2026-06-12**. AWS's own guidance for Copilot users is to migrate to either raw Terraform/CDK or a brand-new tool (ECS Express Mode), not to expect Copilot's continuation (https://aws.amazon.com/blogs/containers/announcing-the-end-of-support-for-the-aws-copilot-cli). And within this very packet's own evidence, `bedrock-agentcore-starter-toolkit` was already declared legacy in favor of `agentcore-cli` within roughly a year of existing. That's two generations of AWS-first-party opinionated deploy CLI in adjacent problem spaces in under two years. "AWS ships it" is not the same claim as "AWS will keep shipping it in this form" — AWS has a live, recent pattern of not doing that in exactly this category. This is the strongest rebuttal to "don't bother, AWS owns it": ownership has not meant durability here.

## Precedent research: when did the third-party layer actually win, and does it apply?

| Precedent                           | Why it won                                                                                                                                                                                                                          | Does the condition hold for langonrock?                                                                                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Serverless Framework vs AWS SAM** | First-mover (2015, before SAM existed usefully), multi-cloud, 1000+ plugin ecosystem (https://www.techmagic.co/blog/serverless-framework-vs-aws-sam)                                                                                | No — agentcore-cli already exists and is being actively built; no first-mover window                                                                                      |
| **Terraform vs CloudFormation**     | Genuine multi-cloud (62% IaC market share per Firefly's State of IaC 2025), superior state/plan-diff workflow, HCL ergonomics, module ecosystem (https://spacelift.io/blog/terraform-vs-cloudformation)                             | Only if multi-cloud is a _real_, decided requirement — open unknown in the packet                                                                                         |
| **SST vs AWS CDK**                  | CDK's own team concluded CDK is "a hack on top of CloudFormation," and SST was "a hack to unwind the damage" — they eventually rewrote SST entirely off CDK onto Pulumi/API-driven IaC (https://sst.dev/blog/moving-away-from-cdk/) | Early, matching evidence exists (opaque CDK synth errors, #1462; hard-coded stack names, #1799) but this is a nascent signal, not the years-long pattern SST responded to |
| **AWS Copilot CLI**                 | Cautionary tale, not a win — reached end-of-support, AWS itself now redirects users elsewhere (https://aws.amazon.com/blogs/containers/announcing-the-end-of-support-for-the-aws-copilot-cli)                                       | Confirms AWS's own opinionated deploy CLIs in this category are not guaranteed durable — cuts against "just adopt it and stop worrying"                                   |

The pattern across every precedent that _actually won_: first-mover timing, a durable cross-cloud need, or years of dedicated full-time investment (SST's team didn't just wrap CDK — they eventually replaced its entire foundation). None of those three conditions clearly hold for `langonrock` today. That's the honest limit of the YES case: the historical precedents argue for a **narrow, evidence-targeted build**, not for out-competing AWS's roadmap generally.

## Is the framing wrong? Maybe "deploy" isn't the real ask

The user's literal words were about deploying "the agent" (singular, definite) — implying it already exists. I checked what AWS's own documented path looks like for taking an _existing_ LangGraph agent to AgentCore (not a new one from `agentcore create`): it's a manual recipe — import `BedrockAgentCoreApp`, wrap with an `@entrypoint`, containerize, update `.bedrock_agentcore.yaml`, then `cdk deploy` (https://github.com/awslabs/amazon-bedrock-agentcore-samples/blob/main/03-integrations/agentic-frameworks/langgraph/README.md). `agentcore-cli`'s `create` wizard is greenfield-oriented; there's no one-command "wrap my existing repo" flow, and issue #1726 confirms you can't even modify an existing agent's config after creation (e.g., add an authorizer later). If the real ask is "get my existing LangGraph agent onto AgentCore," the highest-leverage deliverable might be a single template/script applying that manual pattern once — not a reusable tool at all.

Separately, the verified issues cluster suspiciously around **operational safety and cost**, not deploy mechanics: quota leaks, undisclosed cost, silent security-control failures, opaque errors. If there's a durable layer here, it looks more like a guardrail/golden-path layer than a "deploy" layer — which matches the prior analysis's own 4th candidate gap, just now with concrete teeth.

## What the user gains even if the artifact is thrown away

- **A documented risk register from firsthand contact**, not marketing claims: e.g., "never run more than N create/teardown cycles with CUSTOM_JWT auth in this account without manually cleaning OAuth2 credential providers" (#1673) is the kind of institutional knowledge that prevents a real incident, independent of whether any code survives.
- **Negotiating leverage**: if there's any AWS account-team relationship, walking in with issue numbers (#1673, #870, #1472) is a materially stronger position than "the CLI feels rough."
- **Cheap reversibility check**: building the narrow guardrail slice (days, not weeks) is itself the fastest way to find out whether the real agent hits these landmines at all — which is a strictly better experiment than the prior analysis's "spend a day deploying as-is" recommendation, because it's targeted at known failure modes instead of generic exploration.

## Why it still might not hold

- This repo closes issues fast (~405 closed vs 179 open in six months). Several of the specific bugs I'm hanging the WARN on (#1673, #870, #1735) could be fixed within weeks by an AWS team clearly triaging actively. A wrapper built to route around today's bugs risks becoming dead code by next quarter.
- I could not verify the "3 API calls" claim from the packet in depth (didn't fully re-derive the Forbes article's specifics) — I don't believe it changes the verdict either way, since my case rests on verified GitHub issues, not on how fast AWS's happy-path onboarding is.
- The `aws-ia/terraform-aws-agentcore` module (https://github.com/aws-ia/terraform-aws-agentcore) is small (24 stars) — I'm citing it to correct the packet's "nothing exists for Terraform" framing, not to claim it's a robust, battle-tested option.
- All of this analysis is bounded by the same open unknowns the packet named: internal-vs-external, existing-agent-vs-new, multi-cloud-real-or-hypothetical, and team size/runway. I've tried to make the conditional branches do the work those unknowns require rather than picking one silently.

## Bottom line

The prior analysis's "AWS owns both ends, don't build" conclusion is too clean. It's built on treating `agentcore-cli` as a finished, settled standard, when the primary evidence (its own issue tracker, fetched directly) shows a 6-month-old preview-tagged tool with real, currently-open, sometimes account-bricking bugs. That is a genuine, honest basis for **WARN**: build a narrow, days-scale guardrail/golden-path layer that specifically closes the five verified gaps found here (custom IAM role enforcement, OAuth2 teardown cleanup, cost-path suppression/visibility, actionable error translation, and a brownfield "wrap my existing LangGraph agent" template) — not the generic "deploy layer on top of LangChain" the question was literally phrased as. I could not, after genuine effort, find that the historical precedents (Terraform, Serverless Framework, SST) actually transfer to justify a full competing deploy tool today — none of their winning conditions (first-mover, proven multi-cloud need, multi-year dedicated investment) are established facts here yet.
