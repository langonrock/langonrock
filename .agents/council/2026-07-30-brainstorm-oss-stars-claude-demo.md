```json
{
  "perspective": "What produces a 15-second video that a stranger reposts? Work backward from the artifact that spreads — the GIF, the card, the clip — to the software that must exist to produce it.",
  "ideas": [
    {
      "name": "AgentDuel",
      "pitch": "Two coding agents, one repo, one bug — race them live, side by side, in your terminal.",
      "what_it_does": "AgentDuel spins up two isolated git worktrees of the same repo, launches two coding-agent CLIs (Claude Code, Codex, Aider, Gemini CLI — whatever the user has installed) against the same task in parallel, and renders both live streams as a split terminal pane. When both finish (or time out), it runs the test suite against each resulting worktree and prints a scoreboard: pass/fail, wall-clock time, lines changed, files touched. The whole run auto-records to a GIF on exit.",
      "first_run": "npx agentduel run --task \"fix the failing test in tests/test_auth.py\" --left claude --right codex --repo . — no credential needed from AgentDuel itself; each agent CLI uses whatever key it's already configured with on the user's machine.",
      "readme_gif": "A terminal splits into two panes labeled CLAUDE and CODEX, both scroll code and diffs simultaneously like a race commentary feed, then freeze on a green checkmark vs a red X with a scoreboard card underneath.",
      "who_stars_it": "A backend engineer who just tried a second agent CLI after months on one and wants a real, visual answer to 'which one actually handles my repo's weird build system' before standardizing their team on one.",
      "closest_existing": "Windsurf's built-in 'Arena Mode' (runs two Cascade agents in parallel on one prompt, ide-native, proprietary — infoq.com/news/2026/02/windsurf-arena-mode) and Qwen Code's 'Agent Arena' (qwenlm.github.io/qwen-code-docs, dispatches multiple models at one task inside the Qwen CLI only). A one-off manual demo also exists as a blog post (danielvanstrien.xyz/posts/2026/agent-race) — two terminals side by side, no reusable tool. AMD-AGI/AgentKernelArena (github.com/AMD-AGI/AgentKernelArena) benchmarks agents side-by-side but only on GPU-kernel tasks, no live visual, not agent-agnostic.",
      "why_different": "Everything found is either a proprietary feature locked to one vendor's IDE/CLI, or a narrow domain-specific benchmark with no live rendering. Nothing found is a standalone, agent-agnostic, downloadable harness that races whatever CLIs a stranger already has installed, on their own repo, and produces a shareable artifact. This is a real gap, not a rename of something that ships.",
      "criteria_scores": {
        "no_credential_60s": "3",
        "demo_sells_itself": "5",
        "own_problem": "4",
        "land_grab_timing": "4",
        "launchable_moment": "5"
      },
      "star_range_12mo": "700-3,500 — the demo is close to perfect for a launch clip and the utility (which agent handles my repo?) is a real recurring itch, but it's a niche dev-tool, not a platform, and depends on multiple competing agent CLIs staying relevant enough to be worth racing.",
      "effort_to_v1": "2-4 weeks",
      "maintenance_shape": "needs sustained maintenance",
      "biggest_risk": "Every agent CLI it wraps ships weekly and can change flags, output format, or streaming behavior without warning — the wrapper breaks faster than one person can patch it. Worse, if a major vendor (Anthropic, OpenAI, Google) ships this exact 'race mode' natively, the way Windsurf and Qwen already did inside their own tools, a standalone version stops feeling necessary."
    },
    {
      "name": "PromptTrap",
      "pitch": "A website built to trick your own autonomous agent — point it here and watch, live, what it does.",
      "what_it_does": "PromptTrap is a self-hosted 'haunted house' web page laced with invisible prompt injections designed to be harmless but absurd: hidden instructions that try to get a browsing/computer-use agent to order 500 rubber ducks, write a resignation letter to its own developer, or narrate its actions in iambic pentameter. A local CLI serves the page, logs every instruction the agent actually obeyed, and renders the transcript into a 'gotcha.gif' — timestamped screenshots of the page next to the agent's terminal reacting to it.",
      "first_run": "npx agentzoo serve — spins up the trap site at localhost:4173; the user then points their own browsing agent at it. No credential required to run the trap; the visitor's own agent needs whatever key it already has.",
      "readme_gif": "A browser pane shows an innocuous-looking blog post; a terminal pane beside it shows an agent's log suddenly detouring into 'Adding 500 rubber ducks to cart...' before the two panes freeze on a captioned card reading what the agent actually did.",
      "who_stars_it": "A developer who just read a prompt-injection headline, is skeptical it's really that easy, and wants to test it on their own agent live — then posts the clip because it's funnier and more convincing than the headline.",
      "closest_existing": "PalisadeResearch/llm-honeypot (github.com/PalisadeResearch/llm-honeypot) extends the Cowrie SSH honeypot with prompt-injection traps to detect autonomous LLM hacking agents — closest technical cousin, but it targets SSH-probing bots for security research, not general browsing/computer-use agents, and its output is a research log, not a shareable comedy artifact. svenmorgenrothio/Prompt-Injection-Playground and OWASP-adjacent CTF tools (AIGoat, Praetorian's Augustus) are built for a human manually trying attack strings against a chatbot, not for an autonomous agent to walk into on its own.",
      "why_different": "The mechanic (prompt-injection honeypot) is not new — PalisadeResearch proves that. What's missing is the framing: nothing found is built to autonomously catch a general-purpose agent, capture the moment for laughs, and hand the owner a postable artifact rather than a security report. That framing shift is real but modest — this is closer to 'unclaimed angle on a known mechanic' than 'unclaimed mechanic.'",
      "criteria_scores": {
        "no_credential_60s": "4",
        "demo_sells_itself": "5",
        "own_problem": "3",
        "land_grab_timing": "3",
        "launchable_moment": "5"
      },
      "star_range_12mo": "500-4,000 — wide range because this is the kind of thing that can spike hard if one clip goes wide on X, but it decays fast once the novelty wears off and carries real risk of being read as adversarial toward agent vendors.",
      "effort_to_v1": "weekend",
      "maintenance_shape": "needs sustained maintenance",
      "biggest_risk": "Ambiguous optics. A tool built to trick AI agents into embarrassing behavior reads to some as playful research and to others as 'a tool for attacking AI products' — that can draw pushback, and today's clever injection is next month's patched vulnerability, so the joke has a shelf life that requires the maintainer to keep inventing new tricks."
    },
    {
      "name": "SessionReel",
      "pitch": "Turn a six-hour autonomous agent session into a 20-second trailer, cut like a movie, not a screen recording.",
      "what_it_does": "SessionReel reads a finished local agent session transcript and auto-edits it into a short, scored clip: it detects the moments that matter — first error, the big refactor, the final green test run — and cuts directly between them with on-screen captions, skipping the dead air, instead of replaying the session linearly. Output is a GIF or MP4 sized for posting, not a tool for monitoring or debugging.",
      "first_run": "npx sessionreel render ~/.claude/projects/<project>/<session>.jsonl -o reel.gif — no credential needed in default heuristic mode; an optional --narrate flag adds LLM-written captions and needs an API key.",
      "readme_gif": "A jump-cut sequence: a wall of red error text flashes for half a second, cuts to a diff view mid-refactor, cuts to a terminal typing 'tests passed' in green, all backed by a title card reading the task in one line — the whole thing lasts under fifteen seconds.",
      "who_stars_it": "A developer who just finished a genuinely wild overnight autonomous agent run and wants a fifteen-second clip to post instead of a screenshot of a wall of scrollback text nobody will read.",
      "closest_existing": "es617/claude-replay (github.com/es617/claude-replay) converts agent sessions into full, linear, embeddable HTML replays — closest existing tool, but it replays everything at real pace for review, it does not edit. paulrobello/claude-office (github.com/paulrobello/claude-office, 424 stars) is a real-time pixel-art simulation of a live session, not a post-hoc edit of a finished one.",
      "why_different": "Every competitor found is a live monitor or a complete linear replay — a security camera. SessionReel is a movie trailer: short, edited, dramatized, built to be posted rather than reviewed. That's a genuinely different product shape, not a restyled dashboard, and it's honestly the harder build of the two because the edit has to be good or the whole pitch collapses.",
      "criteria_scores": {
        "no_credential_60s": "4",
        "demo_sells_itself": "4",
        "own_problem": "3",
        "land_grab_timing": "3",
        "launchable_moment": "4"
      },
      "star_range_12mo": "250-1,500 — solid niche fit for the 'GIF-first' thesis, but capped hard by how difficult good automatic editing actually is; a mediocre auto-cut produces a boring reel and the whole idea stops working.",
      "effort_to_v1": "2-4 weeks",
      "maintenance_shape": "needs sustained maintenance",
      "biggest_risk": "The hard part isn't rendering, it's picking WHICH moments are dramatic — that's a genuinely hard heuristic problem, and every agent CLI's session log format drifts across versions, so the moment-detector needs constant retuning just to keep working, let alone stay good."
    },
    {
      "name": "AgentGlass",
      "pitch": "A gorgeous terminal skin for any coding agent you already use — pipe Claude Code, Aider, or Codex through it.",
      "what_it_does": "AgentGlass is a rendering layer, not a new agent: it wraps an existing agent CLI's process, parses its output, and re-renders it through a redesigned, minimal, high-production-value TUI — a live typewriter panel for the model's running commentary, a file tree that lights up as files are touched, and diffs that animate in rather than dump as a wall of plus/minus lines. Zero lock-in: swap agents by changing one flag.",
      "first_run": "npx agentglass -- claude (or -- aider, -- codex) — installs in seconds; the wrapped agent needs whatever credential it already requires, AgentGlass itself needs none.",
      "readme_gif": "A default, slightly ugly scrolling terminal on the left is mirrored on the right by the same session rendered through AgentGlass — smooth panel transitions, a glowing file tree, and an inline diff that animates character by character — captioned 'same agent, same session.'",
      "who_stars_it": "A developer who spends eight hours a day staring at a coding agent's scrolling monochrome output and will install a wrapper purely because it makes that time visually nicer — the same impulse that made people install lazygit or btop for tools that already worked fine.",
      "closest_existing": "caaarlxs/claude-tui and gignit/claude-tui (two separately maintained repos, both github.com/*/claude-tui) wrap Claude Code in a TUI with file tree and diff navigator; asheshgoplani/agent-deck (github.com/asheshgoplani/agent-deck) and nyanko3141592/tmuxcc (github.com/nyanko3141592/tmuxcc) manage multiple agent CLIs in one TUI. None found market themselves on visual production value — they're described as session/file managers, not as something people install for the screenshot.",
      "why_different": "The functional territory (TUI wrapper for agent CLIs) is more crowded than expected — four to five adjacent projects exist. The differentiation is narrow but real: aesthetics as the entire pitch, the way lazygit and yazi are shared for how they look, not multi-agent session management as the pitch. This is a thinner wedge than it first appears and should be scoped that way.",
      "criteria_scores": {
        "no_credential_60s": "4",
        "demo_sells_itself": "5",
        "own_problem": "4",
        "land_grab_timing": "2",
        "launchable_moment": "4"
      },
      "star_range_12mo": "600-5,000 — the widest realistic upside of this set, because aesthetics-first CLI tools have real precedent for breaking out (lazygit, yazi, btop all did), but this is a screen-scraper against other vendors' output, not an original interface, so I'm not assuming lazygit-tier by default.",
      "effort_to_v1": "2-3 months",
      "maintenance_shape": "dies without daily attention",
      "biggest_risk": "It's a screen-scraper wrapping CLIs whose output format is not a stable API — every upstream release is a potential breaking change across every agent it supports. And if any of Claude Code, Codex, or Gemini CLI ship a first-party pretty-TUI mode, the entire premise, a skin for an ugly CLI, evaporates overnight."
    },
    {
      "name": "AgentBlooper",
      "pitch": "Mine your own agent's session logs for its most chaotic moments and turn them into a two-second clip.",
      "what_it_does": "AgentBlooper scans local session transcripts for pattern-matched chaos: the same failing command retried eight times in a row, a hallucinated file path, an agent apologizing three times in one paragraph, a near-miss on a destructive command. No LLM call needed for detection — it's heuristic pattern matching over the transcript. Each hit becomes a shareable 'blooper card': the offending excerpt, formatted, with an optional one-click submit to a public, anonymized gallery of the funniest finds.",
      "first_run": "npx agentblooper scan ~/.claude/projects/ — pure local log mining, no credential required; --submit is opt-in and posts an anonymized excerpt to the public gallery.",
      "readme_gif": "A terminal fills with eight identical lines of 'pip install numpy' each followed by the same error, then a card slides in over it reading 'Blooper #4: The Loop' with a share button.",
      "who_stars_it": "A developer who just watched their agent try the exact same failing command eleven times in a row and wants to turn that specific humiliation into a two-second clip instead of just closing the laptop and moving on.",
      "closest_existing": "None found after searching for an agent-log blooper or chaos detector specifically. Adjacent tools mine session logs for debugging or search (Dicklesworthstone/coding_agent_session_search, Priivacy-ai/agent-log-analyzer, hoangsonww/Claude-Code-Agent-Monitor) but all are diagnostic/monitoring tools aimed at understanding what went wrong, not comedy tools aimed at sharing that something funny went wrong.",
      "why_different": "Genuinely appears to be an open niche — the mining mechanic exists everywhere for debugging, but nobody is pointing it at humor. That said, this is a small, low-effort idea, and its whole ceiling depends on a public gallery having good content, which the tool alone cannot guarantee.",
      "criteria_scores": {
        "no_credential_60s": "5",
        "demo_sells_itself": "4",
        "own_problem": "3",
        "land_grab_timing": "4",
        "launchable_moment": "3"
      },
      "star_range_12mo": "150-1,200 — genuinely funny when it hits, but low without a seed of good bloopers and someone willing to curate the gallery; this is a cold-start problem the tool itself can't solve.",
      "effort_to_v1": "weekend",
      "maintenance_shape": "needs sustained maintenance",
      "biggest_risk": "A 'best of' gallery with zero submissions in week one isn't funny, and there's no way to manufacture the funniest failures without it looking staged — this idea launches flat unless paired with a seed corpus or a launch collaboration that seeds it with real, funny content on day one."
    },
    {
      "name": "TokenBloom",
      "pitch": "A generative-art screensaver that renders your agent's live token stream as evolving particle art instead of text.",
      "what_it_does": "TokenBloom hooks into a live model call and, instead of printing tokens as text, renders them as an evolving abstract visualization in the terminal — particle density, color, and motion driven by token entropy and streaming speed. It has no other function. It does not help you code, debug, or understand your agent. It is a screensaver.",
      "first_run": "npx tokenbloom \"explain quantum computing\" --model claude — streams a live prompt to the configured model and renders the stream as generative art, recording a GIF on exit. Needs the LLM API key the user already has.",
      "readme_gif": "A black terminal fills with a slowly blooming, colorful particle field that pulses and shifts hue in sync with an invisible model 'thinking,' with no text visible at all, captioned only with the prompt that triggered it.",
      "who_stars_it": "Someone setting up a livestream overlay or a desk-setup screenshot who wants something hypnotic running in a terminal pane in the background — not someone trying to get work done.",
      "closest_existing": "junhoyeo/tokscale (github.com/junhoyeo/tokscale) tracks token usage with a 2D/3D TUI and a leaderboard — functional, not decorative. FateScript/token_visualizer and Mattbusel/Token-Visualizer analyze and optimize prompts. None found are purely aesthetic, utility-zero generative art — that specific niche appears open, likely because there's little reason to build it.",
      "why_different": "It is different because almost nobody would bother, not because it's hard to find. I'm including it because it's the sharpest test case of this council's own honesty check: it could plausibly produce the single best GIF of this entire list, and it is also the most likely to be a viral GIF wrapped around a hollow tool. I'd rather name that plainly than pretend it isn't the pattern.",
      "criteria_scores": {
        "no_credential_60s": "3",
        "demo_sells_itself": "5",
        "own_problem": "1",
        "land_grab_timing": "3",
        "launchable_moment": "4"
      },
      "star_range_12mo": "200-2,500 — wide range purely because a beautiful, useless GIF can spike unpredictably on aesthetics alone, but expect steep post-launch decay and near-zero repeat installs once the novelty is seen once.",
      "effort_to_v1": "weekend",
      "maintenance_shape": "launch-and-coast",
      "biggest_risk": "It does nothing. Once the novelty GIF has been seen, there is no reason to install it, run it twice, or star the repo instead of just watching the ten-second video someone else already posted. This is the exact failure mode the honesty check warns about, named against my own idea rather than someone else's."
    }
  ],
  "ideas_i_killed": [
    {
      "idea": "A live LangGraph/agent execution-graph visualizer — nodes lighting up as they run, edges pulsing.",
      "killed_because": "Already crowded and partly first-party owned: mk-tdev/langgraph-viz and proactive-agent/langgraphics (github.com/proactive-agent/langgraphics) both do exactly this, and LangSmith/Langfuse (langfuse.com/guides/cookbook/integration_langgraph) cover it commercially. This is the same pincer shape that killed the original langonrock idea — do not re-propose LangGraph-adjacent tooling."
    },
    {
      "idea": "A 'roast my repo/profile' card generator — an agent scores your code or GitHub profile and produces a shareable roast card.",
      "killed_because": "This is not a gap, it's a genre with at least seven living entries: iDouglasD/dev-roast, Rohan5commit/roast-my-code, jacksonkasi0/roast-me, RetrogradeDev/github-roaster, Haimantika/GitHub-roast, gitroast.me, and github-roast.pages.dev. Any new entrant needs a genuinely new angle to be worth the search results alone; none of the angles I could find added one."
    },
    {
      "idea": "'Claude Code Wrapped' — a Spotify-Wrapped-style shareable card from your local agent usage stats (tokens, peak hours, persona, streaks).",
      "killed_because": "phanisaimunipalli/claudewrapped (github.com/phanisaimunipalli/claudewrapped) already does exactly this: reads ~/.claude/, computes persona/tokens/peak-hour/streak data, and ships a customizable shareable card. Nothing left to differentiate on."
    },
    {
      "idea": "Two AI agents debating a topic, live in the terminal, judged by a third agent.",
      "killed_because": "Common hobby-project pattern with multiple existing implementations: NeoVand/Debater, iason-solomos/Deb8flow, muthuspark/multi-agent-debate. No evidence any of them broke out past a few dozen stars, suggesting the concept itself, not the execution, caps the ceiling low."
    },
    {
      "idea": "A real-time visual monitor of a live Claude Code / multi-agent session (dashboard, pixel-art office, or particle swarm).",
      "killed_because": "This exact space is unexpectedly dense: paulrobello/claude-office (424 stars, pixel-art office sim), tormodt/claude-code-agent-visualizer, patoles/agent-flow, es617/claude-replay, d-kimuson/claude-code-viewer all ship live or near-live visualizations of agent sessions today. I redirected the underlying instinct into SessionReel (post-hoc edited trailer, not live monitor) and AgentGlass (universal skin, not single-vendor dashboard) instead of adding a seventh live-monitor entry to an already-crowded shelf."
    }
  ],
  "critique_of_the_criteria": "Criterion 2 ('has a GIF that sells it') is necessary but the packet's own honesty-check paragraph already half-admits it isn't sufficient — TokenBloom scores a 5 on demo_sells_itself and a 1 on actually being worth anything, and the five criteria have no line item that catches that gap. I'd add a sixth, implicit criterion: does using it a SECOND time teach or produce anything new, or was the value entirely consumed by the first watch? PromptTrap and TokenBloom both fail that test; AgentDuel and AgentGlass pass it because the tool keeps being useful after the first GIF is made. Separately, criterion 4 (land-grab timing) is in direct tension with criteria 1+2 for anything that wraps a third-party agent CLI's output or process (AgentDuel, AgentGlass): being early on an unowned surface is only a land grab until the surface owner — Anthropic, OpenAI, Google, or an IDE vendor — ships the same feature natively, at which point the standalone tool's 'land grab' becomes a maintenance trap defending against the exact platforms it depends on. Windsurf and Qwen Code already shipping native arena/race modes is the concrete instance of this happening on a 2026 timescale, not a hypothetical. The five criteria don't mention this dependency-on-a-moving-target risk anywhere, and for half of my ideas it is the single biggest determinant of whether the project survives past six months.",
  "top_pick": "AgentDuel. It's the cleanest embodiment of 'write the GIF first': two live terminals, a countdown, code streaming in, a scoreboard at the end — nothing about that needs explaining in a tweet. Unlike PromptTrap and TokenBloom it has real recurring utility beyond the clip (which agent should I actually use on this repo is a question people ask themselves repeatedly, not once), which means it doesn't depend entirely on going viral to be worth keeping installed. It also fits the author's stated skills well — orchestrating agent processes and comfortable infra work, not a frontend/pixi.js build like claude-office or a hard editorial-judgment problem like SessionReel — and it doesn't require sustained personal-brand marketing, since the artifact does the talking, which matters for a non-native-English-speaking, non-hype-shipper profile. Its biggest weakness, dependency on multiple third-party CLIs that could absorb the feature natively, is real, but it's the same weakness every idea on this list that touches an existing agent CLI shares, and AgentDuel's core mechanic (shell out to two processes, diff two worktrees, render a split pane) is simpler and more stable to maintain than AgentGlass's full ANSI-scraping skin.",
  "schema_version": 3
}
```

# Demo's brainstorm: work backward from the GIF

My assignment was narrow on purpose: don't start from "what agent problem needs solving," start from "what's on screen in the fifteen seconds a stranger watches before deciding to repost it," and only then figure out what software has to exist to produce that. The packet's own data supports this angle bluntly — three of the top five agent repos (Langflow ~146k, Dify ~136k, Flowise ~51k) are visual builders where the screenshot literally is the pitch, and OpenClaw went from 9k to 60k stars in days on a self-hosted-agent-doing-visible-things demo, no enterprise sales motion involved.

## What I actually found while checking

The most useful thing this research did was disprove my own first instincts. I went in assuming "live visualization of a Claude Code session" was open ground — it is not. It's one of the most crowded corners I checked: `claude-office` (424 stars, real-time pixel-art office sim), `claude-code-agent-visualizer`, `agent-flow`, `claude-replay`, `claude-code-viewer`, and `argus` all exist today, several actively maintained, several genuinely well-executed. Similarly, "GitHub Wrapped for your agent usage" isn't a gap — `claudewrapped` already ships the persona/tokens/streak card I was about to propose. And "roast my repo/profile" isn't an underexplored niche, it's practically a genre with seven-plus living entries.

That's a useful signal in itself: the ideas that are _obvious_ from this angle (visualize a session, score a repo, wrap your year) are obvious to everyone, and the shelf is already full. The ideas worth proposing had to be one layer removed — not "watch the agent work" but "race two agents and watch them," not "get a card about your usage" but "get a trailer of your best run," not "a nicer session monitor" but "a skin that works on any agent's CLI, sold purely on looks."

## The six ideas, in one line each

1. **AgentDuel** — two coding-agent CLIs race the same task in a live split terminal, scoreboard at the end. Top pick: best combination of demo, recurring utility, and fit for the author's infra-orchestration skill set.
2. **PromptTrap** — a self-hosted honeypot site that catches your own autonomous agent falling for a prompt injection, on camera, played for laughs rather than a security report.
3. **SessionReel** — takes a finished agent session log and auto-edits it into a fifteen-second trailer, not a linear replay.
4. **AgentGlass** — a purely aesthetic terminal skin for any agent CLI, sold on looks alone, the lazygit/yazi playbook applied to agent output.
5. **AgentBlooper** — mines your own session logs for chaotic moments (retry loops, hallucinated paths) and turns them into shareable blooper cards.
6. **TokenBloom** — a generative-art screensaver driven by a live token stream. I'm including it specifically because it's the cleanest test of this council's own honesty check: probably the single prettiest GIF on this list, and almost certainly the most hollow tool. Said plainly in its own entry rather than left for someone else to catch.

## Where I pushed back on the brief

The five criteria treat "has a GIF" as most of the battle. It isn't — TokenBloom proves that inside my own list, scoring a 5 on demo appeal and a 1 on being worth anything. I flagged a missing sixth axis (does a second use of the tool produce new value, or was everything already spent on the first watch) in `critique_of_the_criteria`, and I flagged a second gap specific to my angle: several of the strongest demo ideas here (AgentDuel, AgentGlass) work by wrapping someone else's CLI output, which means their "land grab timing" is really a countdown against the platform vendor shipping the same feature natively — which Windsurf and Qwen Code have already started doing in 2026, not hypothetically.

## Enumeration against the brief

- 5–7 concrete named projects → done, 6 delivered.
- Each with GIF-first description, first-run command, credential requirement → done.
- Honesty check with search + named competitor + URL for every idea → done for all 6.
- `ideas_i_killed` with evidence → done, 5 killed ideas logged.
- Calibrated 12-month star ranges, not inflated → done; top of range across all six tops out at 5,000, nothing claims OpenClaw-scale outcomes.
- No verdict, no convergence, no advice-shaped output → followed; this stays in brainstorm mode as instructed.
