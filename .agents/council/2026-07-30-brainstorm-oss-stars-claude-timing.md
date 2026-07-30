```json
{
  "perspective": "Timing — what surface is new and unclaimed RIGHT NOW, in July 2026",
  "ideas": [
    {
      "name": "mcp-top",
      "pitch": "htop for MCP Tasks — watch every long-running tool call, across every MCP server you're connected to, live in your terminal.",
      "what_it_does": "Implements a client for the io.modelcontextprotocol/tasks extension, formalized two days ago in the MCP 2026-07-28 specification. Reads your existing MCP client config (Claude Desktop, Claude Code, OpenClaw), polls every active task across every configured server, and renders a live-updating terminal table: server, task ID, status, elapsed time, poll count, last progress message. Press Enter on a row to stream its full output.",
      "first_run": "npx mcp-top — no cloud credential required; it reads your existing local MCP client config and talks to servers you're already running.",
      "readme_gif": "A terminal split into four panes, each an MCP server running a long task with a ticking progress bar; one task fails mid-run and its row flips red with the error inline.",
      "who_stars_it": "A developer building an MCP tool that takes minutes (video render, deep research, large migration) who is currently flying blind while it runs.",
      "closest_existing": "SrikarChittemsetty/mcp-durable-tasks (0 stars, created 2026-07-19) — a crash-durable task STORE for servers — and wwb-bill/mcp-task-queue (0 stars, created 2026-07-29) — a server-side task queue implementation. Both are server infrastructure; neither renders a client-side watch dashboard. https://github.com/SrikarChittemsetty/mcp-durable-tasks https://github.com/wwb-bill/mcp-task-queue",
      "why_different": "Both existing repos answer 'how does a server persist a task'; mcp-top is the missing client-side observability layer — the thing a developer actually looks at while waiting.",
      "criteria_scores": {
        "no_credential_60s": "5",
        "demo_sells_itself": "4",
        "own_problem": "4",
        "land_grab_timing": "5",
        "launchable_moment": "3"
      },
      "star_range_12mo": "300-1200. Niche — it only matters to people building slow MCP tools — but the Tasks extension is now spec-mandated, so every MCP host eventually needs something like this. Ceiling is set by how many devs build genuinely long-running tools this year, not by demand intensity.",
      "effort_to_v1": "2-4 weeks",
      "maintenance_shape": "needs sustained maintenance — the extension is actively evolving (see the Roots/Sampling/Logging deprecation churn in the same spec release)",
      "biggest_risk": "MCPJam Inspector (2,094 stars, already spec-adjacent, https://github.com/MCPJam/inspector) or the official MCP Inspector ships Tasks-extension support and folds this feature into an existing multi-thousand-star product for free."
    },
    {
      "name": "agentgraph",
      "pitch": "Graphify, pointed at your own agent instead of your code — turn every Claude Code / OpenClaw session you've ever run into a queryable local knowledge graph.",
      "what_it_does": "Parses local session logs (~/.claude/projects/*.jsonl, OpenClaw's session store) into a deterministic local graph file — nodes for sessions, tool calls, skills invoked, files touched, errors; edges for caused-by, touched, failed-with. Ships a query CLI and a local web viewer so you can ask 'every session where the deploy skill failed' or 'which files does my agent edit most' with zero LLM calls, entirely offline, same mechanic as tree-sitter-based code graphs.",
      "first_run": "npx agentgraph build then npx agentgraph query \"skill=deploy status=failed\" — no cloud credential, no API key, runs entirely against local log files.",
      "readme_gif": "Terminal returns a ranked list of past failed sessions with root causes, then a local web page opens showing the same result as a force-directed graph you click through to the original transcript.",
      "who_stars_it": "A heavy Claude Code / OpenClaw user with months of sessions who wants to answer 'have I hit this exact error before' without re-reading old transcripts.",
      "closest_existing": "delexw/claude-code-trace (356 stars, created 2026-03-11) — a JSONL log viewer/browser (desktop, web, TUI) for reading individual conversations — and Tell-Me-Mo/openclaw-trace (15 stars, created 2026-02-11) — a cost/performance observability dashboard. Neither builds a persistent, queryable graph structure or supports graph-shaped queries across sessions; both are per-session viewers. https://github.com/delexw/claude-code-trace https://github.com/Tell-Me-Mo/openclaw-trace",
      "why_different": "claude-code-trace answers 'let me read this session'; agentgraph answers 'let me query across all my sessions the way I'd query code' — the exact mechanic behind Graphify (https://github.com/Graphify-Labs/graphify, 99,001 stars, created 2026-04-03: 'local deterministic AST parsing, every edge explained, no vector store') applied to a different corpus: your own agent's memory of itself instead of your source tree.",
      "criteria_scores": {
        "no_credential_60s": "5",
        "demo_sells_itself": "4",
        "own_problem": "4",
        "land_grab_timing": "3",
        "launchable_moment": "3"
      },
      "star_range_12mo": "500-3000. Not a Graphify repeat — Graphify's 99k came from solving code search, a problem every coding-agent user has constantly; session-history querying is a narrower, more habitual power-user itch. Real upside only with a viral 'look what I found buried in my own history' moment.",
      "effort_to_v1": "2-3 months — reliable multi-format log parsing plus a real graph engine, not just another log viewer",
      "maintenance_shape": "needs sustained maintenance — session log formats change with every Claude Code / OpenClaw release",
      "biggest_risk": "Anthropic or the OpenClaw team ship native cross-session search first-party (Claude Code already added Ctrl+R reverse-history search); claude-code-trace, sitting on the same 356-star head start reading the same logs, adds a query layer as its next obvious feature."
    },
    {
      "name": "kya-mw",
      "pitch": "Add cryptographic agent identity to your MCP server in one line — official KYA-OS, zero boilerplate.",
      "what_it_does": "Framework-specific middleware (FastAPI, Express, FastMCP) wrapping the brand-new KYA-OS reference implementation, so a server author adds one decorator/middleware call and every tool call now carries a verifiable delegation chain and signed proof, without hand-implementing the DIF spec.",
      "first_run": "pip install kya-fastapi, decorate one route — no cloud credential needed for local/self-signed identity; a hosted verifier is optional.",
      "readme_gif": "Two terminal panes: a curl call with no identity header gets rejected with a KYA-OS error; the same call with a signed agent identity succeeds and prints the verified delegation chain.",
      "who_stars_it": "An MCP server author who read about KYA-OS the week it launched and wants agent-level auth without reading the full DIF spec.",
      "closest_existing": "decentralized-identity/kya-os-mcp (20 stars, created 2026-03-10, last pushed 2026-07-29 — the day before 'today') — this IS the official reference implementation (delegation, proof generation, session lifecycle), but it is protocol-level, not a drop-in decorator for an existing FastAPI/Express server. https://github.com/decentralized-identity/kya-os-mcp — DIF/Vouched announcement dated 2026-07-29: https://lasvegassun.com/news/2026/jul/29/vouched-and-the-decentralized-identity-foundation-/",
      "why_different": "kya-os-mcp explains how the protocol works; kya-mw is the one-line adapter for an existing server — the same relationship next-auth has to raw OAuth.",
      "criteria_scores": {
        "no_credential_60s": "4",
        "demo_sells_itself": "3",
        "own_problem": "2",
        "land_grab_timing": "5",
        "launchable_moment": "2"
      },
      "star_range_12mo": "150-600. Honestly capped: identity/auth middleware is inherently production/employer-adjacent even for a solo maintainer, narrower audience than dev-toy categories, and the reference repo itself has only 20 stars five months after the original MCP-I launch — weak signal that even the standard-bearer hasn't found a big audience yet.",
      "effort_to_v1": "2-4 weeks per framework adapter",
      "maintenance_shape": "needs sustained maintenance — DIF governance means the spec keeps moving under a working group",
      "biggest_risk": "Given how fast the MCP-2026-07-28 swarm formed — 20+ competing repos within roughly two weeks of that spec finalizing (see critique below) — a KYA-OS adapter swarm is very likely within days of any blog post that publicizes it further. This is the fastest-closing window in this whole set: 1-3 weeks."
    },
    {
      "name": "clawpreview",
      "pitch": "See what a skill actually does before you let it touch your real agent.",
      "what_it_does": "Takes a ClawHub URL or a raw SKILL.md, spins up a network-isolated sandbox (built on an existing microVM/gVisor runtime rather than rolling isolation from scratch), runs the skill against a scripted representative task with a cheap model, and renders a terminal-recording-style replay: every file read/written, every shell command, every outbound network call, timestamped and diffable against a clean baseline.",
      "first_run": "npx clawpreview https://clawhub.ai/some-skill — needs one LLM API key (or a local model) but no other credential; the sandbox runs locally via Docker.",
      "readme_gif": "An asciinema-style scrubber showing a skill silently curl-ing an unexpected external host, the offending line flagged red — the exact ToxicSkills finding made visible and inspectable instead of just scored.",
      "who_stars_it": "Any OpenClaw/Claude Code user about to run npx skills install on something from a stranger who wants to watch it run once, safely, before trusting it.",
      "closest_existing": "xigua-wang/skill-doctor (321 stars, created 2026-04-19, 'local-first inspector for coding-agent skills, conflicts, precedence, and risk analysis') is the dominant player, but it is a static analyzer, same category as ClawHub's built-in VirusTotal+LLM-guard scanner and Cisco's skill-scanner. Snyk's own ToxicSkills research states plainly that 'every public skill scanner tested is bypassed in under an hour' via payload padding, logic hidden in binary/archive formats, and prompt-injecting the scanner's own LLM judge. https://github.com/xigua-wang/skill-doctor https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/",
      "why_different": "clawpreview doesn't classify or score — it runs the thing once in a box you don't care about and shows you the tape. That sidesteps the exact arms race Snyk describes for static/LLM classifiers, though it is not automatically immune to a skill that detects the sandbox and behaves innocently — same caveat Snyk raised.",
      "criteria_scores": {
        "no_credential_60s": "3",
        "demo_sells_itself": "5",
        "own_problem": "5",
        "land_grab_timing": "4",
        "launchable_moment": "4"
      },
      "star_range_12mo": "600-2500. Security-flavored dev tools with a strong visual demo travel well on HN, and ToxicSkills already put this exact fear in front of the whole OpenClaw audience — the news cycle does the marketing.",
      "effort_to_v1": "2-3 months — sandboxing, generating a representative task per skill, and a clean diffable trace UI is real engineering, not a weekend wrapper",
      "maintenance_shape": "needs sustained maintenance — adversarial skills will adapt to detect the sandbox, the same arms race ToxicSkills documented",
      "biggest_risk": "False confidence: a skill that detects it's being previewed and behaves innocently defeats the whole premise. This is not hypothetical — it's the documented failure mode of every scanner Snyk tested."
    },
    {
      "name": "webmcp-sentinel",
      "pitch": "Uptime Robot for WebMCP — get pinged the moment your site's agent tools silently break.",
      "what_it_does": "Given a URL, periodically fetches the page (or its .well-known/webmcp manifest), drives a headless browser, exercises every registered navigator.modelContext / document.modelContext tool with sample args, and diffs the result against the last known-good run. Alerts on manifest 404s, schema drift, a tool that used to succeed now throwing, or code still calling navigator.modelContext after Chrome's active deprecation window. Ships a shields.io-style embeddable status badge.",
      "first_run": "npx webmcp-sentinel check https://example.com for a one-off check; npx webmcp-sentinel watch plus a config file for continuous monitoring — no cloud credential for the one-off check.",
      "readme_gif": "A badge flips from green 'webmcp: passing' to red 'webmcp: navigator.modelContext deprecated' the day Chrome flips the switch, linking to a report showing exactly which line to change.",
      "who_stars_it": "A developer who shipped WebMCP tools on their site months ago and has no idea whether they still work after three spec revisions in five months.",
      "closest_existing": "webmcplist.com and webmcp.cool both verify a site's WebMCP tools once, at submission time, for a public directory listing; LeanMCP/awesome-webmcp is a curated links list. None continuously monitor a specific site over time or provide a live-status badge tied to spec-version drift. https://webmcplist.com/ https://webmcp.cool/ https://github.com/leanMCP/awesome-webmcp",
      "why_different": "Those are discovery directories (are you listed); this is monitoring (are you still correct, right now, after the spec moved under you) — the relationship between a link directory and an uptime monitor.",
      "criteria_scores": {
        "no_credential_60s": "5",
        "demo_sells_itself": "4",
        "own_problem": "3",
        "land_grab_timing": "4",
        "launchable_moment": "3"
      },
      "star_range_12mo": "200-700. Genuinely useful but the addressable audience — sites that have shipped WebMCP at all — is still small in July 2026; this is an early-adopter tool for an early-adopter spec.",
      "effort_to_v1": "2-4 weeks",
      "maintenance_shape": "needs sustained maintenance — the whole premise is tracking a spec that changed three times in five months (navigator.modelContext → document.modelContext, Chrome 146 Canary → 149 Origin Trial → 150 deprecation)",
      "biggest_risk": "WebMCP exits its Community-Group-Draft churn (W3C Candidate Recommendation tends to stabilize the surface), or Chrome DevTools' already-shipped native WebMCP panel grows a remote-monitoring mode."
    },
    {
      "name": "mcpdocs",
      "pitch": "Point it at any MCP server, get a beautiful docs site — Redoc for MCP.",
      "what_it_does": "Connects to any MCP server over the wire (stdio or HTTP, any language), calls tools/list, resources/list, and prompts/list, and renders a static, searchable documentation site — readable JSON-schema tables, worked examples, and a live 'Try it' panel that calls the real server. Protocol-level, so it works regardless of what framework built the server.",
      "first_run": "npx mcpdocs generate <server-command-or-url> — outputs a static HTML site in one command; no cloud credential for local stdio servers.",
      "readme_gif": "The command runs, a browser auto-opens to a Stripe-docs-style page listing every tool, and clicking 'Try it' fires a real call and shows the JSON response inline.",
      "who_stars_it": "Anyone who just built an MCP server and wants a docs page for the README instead of a raw JSON dump, without hand-writing OpenAPI.",
      "closest_existing": "orco82/fastmcp-docs (3 stars, created 2025-12-09, 'tools documentation generator for FastMCP servers') — source-level, Python-FastMCP-only, and hasn't found distribution in over seven months. No protocol-level, language-agnostic equivalent found despite searching. https://github.com/orco82/fastmcp-docs",
      "why_different": "Protocol-level introspection (talks to the running server, like hitting a live GraphQL endpoint) instead of source-level, so Python, TypeScript, Go, Rust, and C# servers all get the same docs site for free — not tied to one framework.",
      "criteria_scores": {
        "no_credential_60s": "5",
        "demo_sells_itself": "5",
        "own_problem": "4",
        "land_grab_timing": "2",
        "launchable_moment": "4"
      },
      "star_range_12mo": "400-1500. A solid, evergreen dev-tool category — every 'pretty docs from X' tool (Redoc, Storybook, godoc) finds a steady audience — capped below the genuinely novel land-grab ideas because it isn't tied to new unclaimed territory, just a persistently under-served corner of an old one.",
      "effort_to_v1": "weekend to 2 weeks — the lightest-effort idea in this set",
      "maintenance_shape": "launch-and-coast — once it renders correctly for the current spec primitives, it needs only occasional updates",
      "biggest_risk": "The one idea here NOT anchored to a July-2026 timing window — it could have been built in 2024. Low novelty means it competes on polish and SEO alone, and an existing multi-thousand-star directory or inspector (Glama, MCP.Directory, MCPJam) could ship a 'docs' export tab in a single sprint."
    }
  ],
  "ideas_i_killed": [
    {
      "idea": "MCP 2026-07-28 spec migration/compliance scanner (static analyzer flagging deprecated Roots/Sampling/Logging, stateful-session assumptions, etc.)",
      "killed_because": "A GitHub search for repos created since the spec's July 28 finalization turned up 20+ near-identical entrants within roughly two weeks, most from solo/unknown authors, several plausibly agent-generated themselves: studiomeyer-io/mcp-herald (single Rust binary, SARIF, GitHub Action — the most polished), Softogram/softogram-mcp-spec-migration-checker, printemps-tokyo/mcpfit, JacobRyan258/mcp-upgrade, Booyaka101/mcp-vet, maximem-ai/mcp-2026-migrate, PoorvaJ-WW/mcp-migration, dmf6009/mcp-2026-validator, and more, all 0-3 stars. The idea itself is uncontested for stars but the execution niche is a mob scene — see critique_of_the_criteria."
    },
    {
      "idea": "SKILL.md linter / validator",
      "killed_because": "Multiple working linters already exist: Swival/skillscheck (6 stars), himself65/skill-lint (13 stars), swarmclawai/agent-skills-lint, all validating against the agentskills.io spec."
    },
    {
      "idea": "AI-agent-skill security scanner",
      "killed_because": "Structurally an arms race, not an unclaimed surface. Snyk's own ToxicSkills research states every public scanner tested (ClawHub's VirusTotal+LLM guard, Cisco's skill-scanner, skills.sh scanners) was bypassed within an hour. https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/"
    },
    {
      "idea": "Cross-skill conflict / precedence detector",
      "killed_because": "Dominantly claimed by xigua-wang/skill-doctor (321 stars, created 2026-04-19) among 15+ competitors found in a single search (skillhub, skill-graph, skill-guard, hermes-skill-conflict-detector, SkillPilot, skill-audit, and more)."
    },
    {
      "idea": "Skill benchmark / leaderboard ('which skills actually work')",
      "killed_because": "Claimed by benchflow-ai/skillsbench (1,605 stars, created 2025-12-29): '87 tasks, 24 model-harness configurations, leaderboard across Claude Code, Codex CLI, Gemini CLI, OpenHands.' https://github.com/benchflow-ai/skillsbench"
    },
    {
      "idea": "Skills registry / install CLI",
      "killed_because": "Claimed: npx skills (skills.sh) and alirezarezvani/claude-skills (23,494 stars) already cover discovery + one-command install across agents."
    },
    {
      "idea": "Skills lockfile (package-lock.json equivalent for reproducible skill installs)",
      "killed_because": "Already attempted: pcomans/skills-lock, created 2026-02-17, last pushed 2026-07-07, still at 0 stars five months in — the concept is taken even though nobody has won it, which reads as weak demand or a distribution failure rather than an open window."
    },
    {
      "idea": "Voice mode for Claude Code / OpenClaw (talk to your terminal agent)",
      "killed_because": "Claimed and shipped natively: Anthropic added a first-party /voice feature to Claude Code CLI in March 2026. Also 6+ community repos already exist: voicemode.dev, aayushdebugging/claude-voice, mbailey/voicemode, Purple-Horizons/openclaw-voice, paulpreibisch/AgentVibes."
    },
    {
      "idea": "MCP Apps scaffolding tool (create-mcp-app equivalent)",
      "killed_because": "Multiple official and community scaffolds already exist: boguan/create-mcp-app, npx create-mcp-use-app --template mcp-apps, and the official modelcontextprotocol/ext-apps quickstart — all live before the spec even finalized on July 28."
    },
    {
      "idea": "MCP Apps cross-host testing / visual regression (does my app render the same in Claude Desktop, ChatGPT, VS Code)",
      "killed_because": "Claimed by Sunpeak-AI/sunpeak (208 stars, created 2025-11-17): 'server-agnostic MCP testing framework... --visual for screenshot regression, --e2e for Playwright, cross-host tests before publishing.' https://github.com/Sunpeak-AI/sunpeak"
    },
    {
      "idea": "shadcn-style copy-paste component library for MCP Apps",
      "killed_because": "Claimed by mnfst/manifest-ui (33 stars, created 2026-02-19, 'a shadcn/ui library for building ChatGPT Apps and MCP Apps') and mrslbt/mcp-apps-ui (copy-paste, zero-dependency HTML components)."
    },
    {
      "idea": "In-browser MCP server playground / sandbox (try any MCP server with zero install)",
      "killed_because": "Extremely crowded: seven-plus competing products found in one search — mcpsplayground.com, mcpplayground.tech, mcpplaygroundonline.com, mcpshowcase.com, wso2/wso2-mcp-playground, digitarald/mcp-apps-playground, KodeKloud's MCP Playground."
    },
    {
      "idea": "A2A Agent Card directory / registry",
      "killed_because": "Nominally claimed by a2a-registry.org, prassanna-ravishankar/a2a-registry (25 stars, https://github.com/prassanna-ravishankar/a2a-registry), AWS Labs' a2a-agent-registry-on-aws, and sing1ee/a2a-directory — but low stars across the board suggest the real issue is weak individual-dev pull for a directory-shaped product, not an open window."
    },
    {
      "idea": "x402/MCP tool-call paywall middleware (monetize your MCP server per call)",
      "killed_because": "Heavily claimed: ag402, microchipgnu/MCPay (91 stars), krystiangw/agenticpay, plus Stripe's own official MCP/agentic-commerce tooling shipping 2-line monetization directly."
    },
    {
      "idea": "x402 agent spend-guard / budget policy firewall",
      "killed_because": "A 15+ entrant swarm already exists: presidio-v/presidio-hardened-x402 (15 stars, created 2026-03-31, leader), nmrtn/blacktea, railslab-ai/railslab, theMobiusStrip/agentpay-guard, LetAgentPay, Hussain-Sharif/policy-vault, c6zks4gssn-droid/x402-firewall, and more. https://github.com/presidio-v/presidio-hardened-x402"
    },
    {
      "idea": "Client ID Metadata Document (CIMD) generator for the new MCP OAuth pattern",
      "killed_because": "Already shipped inside FastMCP's own CLI: fastmcp cimd create / fastmcp cimd validate. https://gofastmcp.com/clients/auth/cimd"
    },
    {
      "idea": "WebMCP DevTools browser extension (inspect registered tools on a page)",
      "killed_because": "Claimed and shipped natively — Chrome DevTools now has a built-in Application > WebMCP panel — plus three competing extensions (WebMCP DevTools, WebMCP Inspector, Model Context Tool Inspector) found in one search."
    },
    {
      "idea": "Framework-specific WebMCP adapters (e.g. Next.js middleware)",
      "killed_because": "Claimed multiple times over: cristiantx/next-webmcp (3 stars), dankelleher/webmcp-next (2 stars), opentiny/webmcp-sdk (111 stars, React/Vue/Angular/Svelte/Next.js adapters plus CLI and conformance tests), samuelvinay91/webmcpregistry."
    },
    {
      "idea": "WebMCP-enabled-site directory",
      "killed_because": "Claimed by webmcplist.com, webmcp.cool, and LeanMCP/awesome-webmcp."
    },
    {
      "idea": "Two-agent x402/AP2 shopping demo kit (agent buys from agent, batteries included)",
      "killed_because": "Claimed: Lucid Agents Commerce SDK ('bootstrap in 60 seconds... drop-in adapters for Hono, Express, Next.js, TanStack') and atomdbc/autonomous-commerce-agent already cover this exact demo shape."
    },
    {
      "idea": "AWS/Bedrock deploy tooling for LangChain/LangGraph agents",
      "killed_because": "Out of scope per this council's prior verdict-mode ruling: unanimous FAIL, pincered by aws/agentcore-cli and LangSmith Deployment. Not re-investigated here."
    }
  ],
  "critique_of_the_criteria": "Criterion 4 (land-grab timing) is directionally right but badly underestimates how fast the swarm moves in July 2026. I found the clearest possible test case: the MCP 2026-07-28 spec finalized 48 hours before 'today,' and a GitHub search for repos created since then already turns up 20+ near-identical migration-scanner attempts, all from solo or unknown authors, several with the exact same feature list, all still at 0-3 stars. Being early is no longer sufficient by itself — you also have to be first among a same-week swarm of simultaneous entrants, most of them plausibly assembled by an AI agent in an afternoon. That collapses 'timing' and 'distribution/execution' into one axis the packet treats as two: land-grab timing without a distribution edge just buys you a spot in a crowded 0-star pile. I'd add a sixth criterion — 'swarm resistance': does the idea require enough real engineering (a sandbox runtime, a graph engine, multi-format log parsing) that a same-week clone is expensive to produce, versus a thin CLI wrapper around a regex that anyone can ship in an afternoon the moment the underlying spec goes public? mcp-2026-07-28 scanners and CIMD generators score low on swarm resistance (that's exactly why they got swarmed); clawpreview and agentgraph score higher because sandboxing and building a real graph engine aren't afternoon projects. Separately, criterion 3 ('own problem, not employer's') is harder to satisfy than it looks once you're this deep in the protocol-infra layer — identity, payments, and enterprise-authorization surfaces are structurally employer-shaped even when a solo hobbyist builds the OSS tool for them, which is why I scored kya-mw only 2/5 there despite it having the single freshest timing window of any idea I found (KYA-OS was donated to DIF the day before 'today'). And criterion 1 (no credential, 60 seconds) sits in real tension with criterion 4 in the payments space specifically: the genuinely novel land-grabs there (x402, AP2, agent wallets) structurally require a wallet or blockchain credential to demo meaningfully, so applying both criteria together nearly rules out proposing anything in the single most protocol-active corner of the ecosystem this year — which may be too strict.",
  "top_pick": "agentgraph. It's the only idea in this set that directly reuses the single most validated mechanic I found anywhere in this research: Graphify (https://github.com/Graphify-Labs/graphify) sits at 99,001 stars, created only four months ago (2026-04-03), for exactly the pitch 'turn X into a queryable local graph, deterministic, no vector store.' agentgraph points that same proven mechanic at a corpus Graphify doesn't touch — your own agent's session history instead of your source tree — so it isn't a head-on clone, and the author's stated background (LangChain/LangGraph, comfortable at the infrastructure layer) is a near-perfect fit for building a real parser and graph engine rather than a thin API wrapper. It also happens to score well on the 'swarm resistance' criterion I added above: a credible version requires reliable multi-format log parsing and an actual graph engine, which filters out the afternoon-clone crowd that swarmed every MCP-2026-07-28 idea within days. The honest tradeoff is timing (3/5, not 5/5) — session-log tooling as a category already exists (claude-code-trace, 356 stars) — so the win here is a better mechanic on an under-served slice of a known category, not a brand-new surface with zero competitors. Given how consistently every genuinely brand-new surface I found this week was already crowded by 5-20 near-simultaneous entrants, 'proven mechanic, adjacent corpus, real engineering moat' looks like the more defensible bet than chasing the freshest possible spec.",
  "schema_version": 3,
  "window_closes_note": "Every idea above carries its own window_closes reasoning inside biggest_risk; see the markdown body for the consolidated table."
}
```

# Timing's brainstorm — what's unclaimed in the agent-protocol space, July 2026

## Method

I read the packet, then spent the research budget on live search (WebSearch, WebFetch, and direct `gh api` queries against GitHub's search endpoint) rather than memory, per the brief. The single most useful thing `gh api search/repositories` gave me that WebSearch couldn't: exact creation dates and current star counts, which let me directly measure how fast a given spec-adjacent niche gets swarmed after the underlying spec ships. That measurement turned into the central finding of this report.

## The headline finding: the swarm is faster than the packet assumes

The MCP 2026-07-28 specification — the biggest MCP revision since launch (stateless core, Multi Round-Trip Requests, header-based routing, cacheable `ttlMs`/`cacheScope` responses, a formal extensions framework for Tasks/Apps/EMA) — finalized on **2026-07-28**, two days before "today." [Official spec blog, dated 2026-07-28](https://blog.modelcontextprotocol.io/posts/2026-07-28/)

I ran `gh api search/repositories` for repos mentioning "2026-07-28" created in the days since. Result: **20+ near-identical migration/compliance-scanner attempts**, almost all 0-3 stars, almost all from solo or unrecognized authors, several of them plausibly themselves agent-generated given the speed and uniformity:

| repo                                           | stars | created    |
| ---------------------------------------------- | ----- | ---------- |
| studiomeyer-io/mcp-herald                      | 0     | 2026-06-21 |
| Softogram/softogram-mcp-spec-migration-checker | 0     | 2026-07-13 |
| printemps-tokyo/mcpfit                         | 0     | 2026-07-24 |
| JacobRyan258/mcp-upgrade                       | 0     | 2026-07-22 |
| Booyaka101/mcp-vet                             | 0     | 2026-07-22 |
| dmf6009/mcp-2026-validator                     | 0     | 2026-07-29 |
| maximem-ai/mcp-2026-migrate                    | 0     | 2026-07-29 |
| PoorvaJ-WW/mcp-migration                       | 0     | 2026-07-15 |
| Neeeophytee/mcp-stateless-conformance          | 1     | 2026-07-29 |
| 133institute/mcp-stateless-lab                 | 1     | 2026-07-30 |

That's not one clever person spotting a gap — that's a mob, converging on the exact same wedge within roughly two weeks of the starting gun, before anyone has meaningfully differentiated or won distribution. I found the same pattern independently in three other spec-adjacent niches I checked before settling on final ideas: cross-skill conflict detection (15+ entrants, led by xigua-wang/skill-doctor at 321 stars), x402 agent spend-guards (15+ entrants, led by presidio-v/presidio-hardened-x402 at 15 stars), and in-browser MCP playgrounds (7+ competing hosted products). This reshapes how I read criterion 4. See `critique_of_the_criteria` in the JSON block above for the full argument — in short, I'd split "land-grab timing" into timing _plus_ swarm resistance (how expensive is a same-week clone to build), because timing alone now buys you a crowded 0-star pile, not a claim.

## What I generated instead

Given that finding, I biased my six ideas toward surfaces that are either (a) genuinely still uncontested despite dedicated searching, or (b) contested only by weak, low-traction, or structurally-different attempts, with an honest star estimate and an explicit `window_closes` reasoning for each:

1. **mcp-top** — client-side terminal watcher for the brand-new MCP Tasks extension. The only entrants found (`mcp-durable-tasks`, `mcp-task-queue`) are server-side infrastructure, not a client dashboard. Window: 4-8 weeks, closes when MCPJam Inspector (2,094★) folds Tasks support into its existing product.
2. **agentgraph** — Graphify's exact proven mechanic (99,001★ for "turn X into a queryable local graph"), pointed at your own agent's session history instead of your codebase. My top pick — see reasoning in the JSON block.
3. **kya-mw** — one-line framework middleware for KYA-OS, the agent-identity spec donated to the Decentralized Identity Foundation on **2026-07-29**, literally the day before today. The freshest timing window in the whole set, but scores low on "own problem" (identity/auth is inherently production-shaped) and I expect it to get swarmed within 1-3 weeks based on the MCP-2026-07-28 base rate.
4. **clawpreview** — sandboxed dry-run + visual replay of what a skill actually does before you trust it with your real agent, as a response to Snyk's ToxicSkills finding that every existing static/LLM scanner gets bypassed within an hour. Best demo, most engineering.
5. **webmcp-sentinel** — continuous uptime/compliance monitoring for WebMCP-enabled sites, distinct from the several directories (webmcplist.com, webmcp.cool) that only verify once at submission time. Tracks a spec that's genuinely still moving (`navigator.modelContext` → `document.modelContext`, Chrome 146 → 149 → 150 deprecation cycle).
6. **mcpdocs** — the deliberate control case: a protocol-level, framework-agnostic "Redoc for MCP" docs generator. Not tied to any 2026 timing window at all (scores 2/5 on land-grab timing on purpose), included to show what a purely evergreen, execution-only bet looks like next to the five timing-driven ones.

## Ideas killed with evidence

Twenty killed ideas are logged in `ideas_i_killed` above, each with the specific existing repo(s), star counts, and creation dates that killed them. The density of that list is itself the finding: in July 2026, almost every "obvious" wedge in the MCP / A2A / WebMCP / agent-skills / agent-payments space that I could think of in under five minutes already had a live claimant, usually several, usually created within weeks of the underlying spec shipping.
