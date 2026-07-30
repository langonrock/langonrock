```json
{
  "perspective": "What does someone who actually ships LangGraph agents suffer with every single day, that also runs locally?",
  "ideas": [
    {
      "name": "flightdeck",
      "pitch": "A portable, offline flight recorder and time-travel debugger for LangGraph — one file in, full graph replay out, no account.",
      "what_it_does": "Wraps a LangGraph checkpointer so every run (local or production) writes to a single portable SQLite file. `flightdeck view run.flight` opens a localhost-only web UI that renders the graph topology, lets you scrub through every checkpoint the way LangGraph's own 'time travel' feature promises, and diffs the state dict between any two checkpoints. The whole point is that the file is small and self-contained: you can `scp` it off a production pod, email it, or attach it to a GitHub issue, and open it on a laptop with zero network calls.",
      "first_run": "pip install flightdeck && flightdeck record app.py — no cloud credential, no signup, works fully offline.",
      "readme_gif": "A terminal starts a LangGraph run, a browser tab opens showing the graph lighting up node-by-node in real time, then a slider is dragged backward and the state panel updates to show exactly what the state dict looked like three steps ago.",
      "who_stars_it": "A backend engineer who got paged at 2am because a LangGraph agent did something wrong once in production, has no LangSmith project wired up for that service, and wants to copy one file off the box instead of trying to reproduce a race condition blind.",
      "closest_existing": "LangGraph Studio (github.com/langchain-ai/langgraph-studio) — its MacOS Electron app is deprecated; the current supported path is `langgraph dev`, which serves the UI from https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024, i.e. even 'local' debugging loads a page from LangChain's own cloud domain. LangSmith itself (cloud, paid past free tier). Langfuse (27.5k stars) and Opik (~20k stars) are self-hostable but require standing up a server + Postgres/ClickHouse, not a single portable file.",
      "why_different": "Nobody currently ships 'one file, no server, no cloud domain, ever' as the product. Every existing option is either a hosted platform, a self-hosted platform you must operate, or a UI that phones home to LangChain's own domain even when the backend is local. The portable-file model is also what actually answers 'reproduce a failure that happened once in prod' from the brief, which none of the observability platforms solve without prior instrumentation already being live at failure time.",
      "criteria_scores": {
        "no_credential_60s": "5",
        "demo_sells_itself": "5",
        "own_problem": "5",
        "land_grab_timing": "3",
        "launchable_moment": "4"
      },
      "star_range_12mo": "800-2500 in 12 months. Strong demo and a real gap (offline + portable + LangGraph-native), but it's competing for eyeballs against incumbents that already move fast — Opik went from 0 to ~12.5k stars in under a year — so 'well-executed niche tool' rather than 'category winner' is the realistic ceiling.",
      "effort_to_v1": "2-4 weeks",
      "maintenance_shape": "needs sustained maintenance",
      "biggest_risk": "LangChain controls the framework and could ship a genuinely offline mode for `langgraph dev` directly (removing the smith.langchain.com dependency) in a single release, which is the same incumbent-capture pattern that killed the original AWS-deploy idea."
    },
    {
      "name": "pytest-langgraph",
      "pitch": "VCR for LangGraph: record a live run once, replay it deterministically in CI forever, for $0.",
      "what_it_does": "A pytest plugin that records every LLM decision and tool call made during a LangGraph run into a cassette keyed by the graph's own node/edge structure. Subsequent test runs replay the cassette instead of calling the API — zero cost, zero flakiness — and if the graph takes a different path than the cassette recorded (a different node fires, a tool gets different args), the plugin fails with a structural trajectory diff, not just a text diff of the final answer.",
      "first_run": "pip install pytest-langgraph && pytest --record-once — first run needs one real API key to make the initial recording; every run after that needs none.",
      "readme_gif": "A pytest run showing green dots and '$0.00 spent, 0 API calls' printed at the bottom, then a deliberately broken node causing one test to fail with a colorized 'expected node: validate_order, actual node: skip_validation' diff.",
      "who_stars_it": "A LangGraph developer whose CI bill and CI flakiness both come from the same root cause — every PR re-runs the same agent test suite against a live model — and who is tired of tests that fail for no reason on a rerun.",
      "closest_existing": "vcr-langchain (github.com/amosjyng/vcr-langchain, 82 stars) does something similar for LangChain but its own README admits 'a lot of langchain functionality I haven't gotten around to hijacking,' and it predates LangGraph. langchain-replay (github.com/sixty-north/langchain-replay, 1 star) is nearly identical in concept but effectively unknown. langchain-ai/agentevals (463 stars, official LangChain org) does trajectory evaluation but against live or judge-scored runs, not deterministic zero-cost replay.",
      "why_different": "Purpose-built for LangGraph's graph/checkpoint model specifically (the diff is structural — which edge fired — not just message text), and it's a pytest plugin that fits into existing CI rather than a new platform to adopt. Honestly: two prior attempts at this exact idea (vcr-langchain, langchain-replay) both exist and both stalled at trivial star counts, which is a real warning sign about distribution, not just execution.",
      "criteria_scores": {
        "no_credential_60s": "5",
        "demo_sells_itself": "4",
        "own_problem": "5",
        "land_grab_timing": "3",
        "launchable_moment": "3"
      },
      "star_range_12mo": "300-900. This is the literal pain named in the brief ('tests for something that never returns the same output twice'), but two prior implementations of essentially this idea have already been built and neither broke out, which caps my confidence.",
      "effort_to_v1": "2-4 weeks",
      "maintenance_shape": "needs sustained maintenance — must track LangGraph API changes, which the GitHub issue tracker shows happen often (see checkpoint-behavior issues below).",
      "biggest_risk": "The two prior attempts (vcr-langchain, langchain-replay) suggest either the pain isn't as sharp as it feels, or people solve it by hand-rolling a mock instead of adopting a dependency — the tool has to prove it's worth the install, not just possible to build."
    },
    {
      "name": "contextsent",
      "pitch": "See exactly what got sent to the model — a token budget breakdown by category, not just a total count.",
      "what_it_does": "Wraps your model client or LangGraph app; on every call it captures the exact final serialized payload actually transmitted to the provider (post-truncation, post-trimming, post-tool-binding) and renders a local static HTML report: a stacked bar per call showing how many tokens went to system prompt, tool schemas, conversation history, and retrieved context, plus a diff view between two calls in the same thread to show what got silently dropped.",
      "first_run": "pip install contextsent && contextsent wrap your_app.py — offline, no account, opens a local HTML file.",
      "readme_gif": "A stacked horizontal bar chart where the 'tool schemas' segment is unexpectedly huge — 40% of the budget — with a tooltip revealing which one bound tool definition is eating it.",
      "who_stars_it": "A developer who just watched a HN commenter describe API responses eating '70% of my context window' and realized they have no idea what their own agent's ratio actually is because their tracer shows a token count, not a breakdown.",
      "closest_existing": "LangSmith, Langfuse, Phoenix, and Helicone all show per-call token counts in their trace views, but none of them ship an automatic category breakdown (system vs. tool-schema vs. history vs. retrieved-doc tokens) as a default, one-glance artifact — you'd have to build that dashboard yourself in each.",
      "why_different": "Narrower and sharper than a general trace viewer: single purpose, no server to run, and the categorization is the whole product. Honest caveat: this is a feature, not a platform — any of the incumbents above could ship 'categorized token breakdown' as a checkbox in an afternoon.",
      "criteria_scores": {
        "no_credential_60s": "5",
        "demo_sells_itself": "5",
        "own_problem": "4",
        "land_grab_timing": "2",
        "launchable_moment": "3"
      },
      "star_range_12mo": "200-700. A genuinely nice utility with a great screenshot, but thin as a standalone product — realistic risk is 'cool, closed the tab' rather than 'installed and kept using.'",
      "effort_to_v1": "weekend for a v1 using tiktoken + a static HTML/matplotlib report; 2-4 weeks for polish (multi-provider support, diff mode).",
      "maintenance_shape": "launch-and-coast, once per-provider token counting logic is stable.",
      "biggest_risk": "It's small enough that it reads as a feature request against an existing tool rather than a reason to install a new dependency — without a sticky secondary use (e.g. feeding into a CI budget check) it may plateau early."
    },
    {
      "name": "loopguard",
      "pitch": "A circuit breaker for LangGraph agents that stops the same-tool-same-args loop before it becomes a $400 surprise bill.",
      "what_it_does": "A thin wrapper around a compiled LangGraph graph: `guard(graph, max_repeat=3)` aborts execution the instant the same tool is called with the same (or near-identical) arguments N times in a row, and prints exactly which node/edge is looping — this is a real, documented LangGraph failure mode where certain models keep re-calling a tool after a ToolMessage because `bind_tools()` doesn't automatically set `tool_choice=\"none\"` to force a stop. It also ships `loopguard dry-run app.py`, which runs the graph with a mocked/canned LLM purely to trace which nodes and tools would fire and how often, catching structurally infinite loops before a single real token is spent.",
      "first_run": "pip install loopguard && loopguard dry-run app.py — no cloud credential required for dry-run mode; guard mode wraps whatever client you already use.",
      "readme_gif": "A terminal simulating a runaway agent: the same tool call scrolling by rapidly, then loopguard interrupting mid-stream with 'loop detected: search_db called 3x with identical args at node retrieve — aborting, saved an estimated $41.20.'",
      "who_stars_it": "The exact person in the dev.to post who woke up to a $400 bill because 'one agent called the same tool 47 times in a loop overnight' and wrote: 'You don't find out until a user complains. Or until you check your billing dashboard and feel your stomach drop.'",
      "closest_existing": "LangGraph's own built-in `recursion_limit` (a blunt total-step ceiling, default 25, that raises GraphRecursionError — it does not detect semantic repetition, only step count). AgentOps and Langfuse offer cost alerts, but those fire after the money is already spent, cloud-side.",
      "why_different": "It's a pre-emptive guard, not a post-hoc monitor — it prevents the bill instead of reporting it, and it reads LangGraph's own step/node metadata rather than being a generic OpenTelemetry wrapper. This is the sharpest, most literal match to the brief's cost-surprise pain of anything in this set.",
      "criteria_scores": {
        "no_credential_60s": "5",
        "demo_sells_itself": "4",
        "own_problem": "5",
        "land_grab_timing": "4",
        "launchable_moment": "4"
      },
      "star_range_12mo": "400-1200. Sharp, relatable, well-demoed pain, but it's a single-function utility (closer to a linter than a platform), which caps upside unless scope creeps — which would violate the whole reason it's easy to adopt.",
      "effort_to_v1": "weekend to 2 weeks for the guard; 1-2 more weeks for dry-run mode.",
      "maintenance_shape": "launch-and-coast once the loop-detection heuristic is solid.",
      "biggest_risk": "This is a two-day fix for LangChain to ship upstream (smarter recursion_limit, or auto-setting tool_choice='none' after a ToolMessage) — if they do, the motivating bug disappears and so does most of the pitch."
    },
    {
      "name": "graphdiff",
      "pitch": "git diff for agent runs — what changed between the run that worked and the run that didn't, all in one view.",
      "what_it_does": "A CLI that takes two exported traces (flightdeck files, or LangSmith/Langfuse JSON exports) and produces one unified, colorized diff covering everything that can silently change between two runs of 'the same' agent: system prompt text, tool schema definitions, graph topology (nodes/edges added, removed, reordered), and model parameters (model name, temperature, max_tokens) — instead of making you manually eyeball four different tabs in a dashboard.",
      "first_run": "pip install graphdiff && graphdiff run_a.json run_b.json — offline, no account, works on exported files.",
      "readme_gif": "A terminal split showing a git-style unified diff where the highlighted change is a single tool's JSON schema that silently lost a required field between two deploys.",
      "who_stars_it": "An engineer debugging 'it worked in staging, it's broken in prod' who is currently manually diffing prompts and tool definitions across two browser tabs because no single tool shows both at once.",
      "closest_existing": "PromptGit (github.com/kagehq/promptgit) targets git-native version control for prompt text specifically. Microsoft's Prompty ships a diff tool, also scoped to prompt files, not full runs. LangSmith has an experiment/dataset comparison view, but it's cloud, paid past the free tier, and compares evaluation runs inside its own platform rather than two arbitrary exported traces.",
      "why_different": "Scope is the whole run — prompt, tools, topology, and params together — not just prompt text, and it works offline on exported files rather than requiring both runs to already live inside one paid platform.",
      "criteria_scores": {
        "no_credential_60s": "4",
        "demo_sells_itself": "4",
        "own_problem": "4",
        "land_grab_timing": "3",
        "launchable_moment": "3"
      },
      "star_range_12mo": "250-800. Useful and well-scoped, but it's an incident-time tool people reach for rarely, not daily — lower repeat engagement usually means fewer people bother to star it even if it saved them an hour once.",
      "effort_to_v1": "2-4 weeks",
      "maintenance_shape": "needs sustained maintenance to track the export formats of whatever platforms it reads from.",
      "biggest_risk": "Low frequency of use per user is a structural ceiling on virality — tools people open constantly get evangelized; tools people open once during an incident get used and forgotten."
    },
    {
      "name": "statcheck",
      "pitch": "Hypothesis-style property testing for agents that never give the same answer twice — assert a rate, not a single pass/fail.",
      "what_it_does": "A pytest plugin that runs the same input N times against a real (or local) model and asserts statistical properties across the sample, e.g. `assert_trajectory(app, input, tool_called='search_db', min_rate=0.9, n=10)` fails if the agent doesn't reliably take the expected path in at least 90% of runs. It renders a local HTML report showing a simple branching diagram of which path was taken how often across the N runs, so you can see exactly where a graph is unreliable instead of getting a single green/red pytest dot that hides the flakiness.",
      "first_run": "pip install statcheck && pytest — works against any OpenAI-compatible endpoint including a local Ollama model, so it can run with no cloud credential if pointed at a local model.",
      "readme_gif": "An HTML report showing a branching tree: 'search_db → summarize' taken in 9 of 10 runs, 'search_db → clarify → summarize' taken in 1 of 10, rendered as a simple Sankey-style diagram.",
      "who_stars_it": "A developer who has been told 'just write tests for it' and knows that's a category error for a system that legitimately behaves differently on identical input — they want to assert reliability as a rate, not fake determinism they don't have.",
      "closest_existing": "DeepEval (github.com/confident-ai/deepeval, 13.9k stars) has repeated-sampling-style metrics (G-Eval) but is scoped to general LLM output quality scoring, not LangGraph-trajectory-shaped path assertions. The academic 'AgentAssay' framework (described in recent papers as achieving cost-efficient statistical regression testing) appears to be a research prototype without a clearly established, widely-starred OSS repo yet. langchain-ai/agentevals (463 stars) does single-run trajectory matching, not multi-run statistical confidence.",
      "why_different": "It treats non-determinism as the thing under test — assert a rate, don't eliminate the randomness (unlike VCR-style replay) and don't just hand it to an LLM judge for a quality score. The path-frequency diagram is a genuinely new artifact none of the incumbents render today.",
      "criteria_scores": {
        "no_credential_60s": "4",
        "demo_sells_itself": "4",
        "own_problem": "5",
        "land_grab_timing": "4",
        "launchable_moment": "4"
      },
      "star_range_12mo": "400-1500. The most conceptually novel idea in this set, which cuts both ways — a fresh framing travels well on HN, but unproven framing means demand is a real open question rather than a known quantity.",
      "effort_to_v1": "2-4 weeks for v1 (fixed-N repeated runs, rate assertions, a basic HTML diagram); more for polish.",
      "maintenance_shape": "needs sustained maintenance.",
      "biggest_risk": "N repeated real-model runs make CI slower and non-free by construction — a tool meant to fight cost surprises that itself multiplies API calls by N per assertion is a real tension the pitch has to resolve (default to a local model) rather than paper over."
    }
  ],
  "ideas_i_killed": [
    {
      "idea": "A generic local-first 'LangSmith alternative' — a full self-hosted observability platform (traces, evals, prompt playground, datasets) for LangGraph.",
      "killed_because": "This exact space is already saturated by fast-moving, well-funded open source incumbents: Langfuse (github.com/langfuse/langfuse, 27.5k stars, MIT, free self-host, YC W23), Opik (github.com/comet-ml/opik, ~20k stars, Apache 2.0 with no feature gating, grew from 0 to ~12.5k stars in roughly 8-9 months), Arize Phoenix (github.com/Arize-ai/phoenix, ~10.7k stars, OTel-native), Helicone (github.com/helicone/helicone, ~5.8k stars, YC W23), and AgentOps (github.com/AgentOps-AI/agentops, 5.5k stars). The land-grab window on generalist agent observability closed years ago; a new entrant has no distribution channel these don't already occupy."
    },
    {
      "idea": "A standalone 'semantic correctness' validator that catches tool calls with the right shape but wrong values (the silent-wrong-tool-call pain).",
      "killed_because": "langchain-ai/agentevals (github.com/langchain-ai/agentevals, 463 stars) is the official first-party LangChain org repo doing exactly this — trajectory and tool-call evaluation, both exact-match and LLM-as-judge. Same pattern that killed the original AWS-deploy idea: the incumbent owns the distribution channel (LangChain's own docs) for this exact surface, so a competing standalone tool has no wedge."
    },
    {
      "idea": "A static pre-execution cost/token predictor: 'tell me what this run will cost before you run it,' purely from reading the graph.",
      "killed_because": "The closest real research (Stanford/Microsoft, arXiv 2604.22750, 'How Do AI Agents Spend Your Money?') formalized exactly this task — agents self-estimating token usage pre-execution — and found only modest accuracy with a 'consistent underestimation bias.' A tool promising reliable static cost prediction would be overpromising on a problem the literature says isn't well solved yet. Redirected the underlying pain into loopguard's runtime guard + mocked dry-run instead, which measures rather than predicts."
    },
    {
      "idea": "A standalone 'git for prompts' version-control product, scoped to prompt text.",
      "killed_because": "PromptGit (github.com/kagehq/promptgit) already targets this directly — git-native prompt versioning with branch support, rollback, blame tracking, and diffs — and PromptLayer, Agenta, Vellum, and Braintrust all sell prompt registries with diffing as a feature. Folded the genuinely underserved slice (diffing a whole run — prompt + tools + topology + params together, not just prompt text) into graphdiff instead of proposing a directly competing prompt-only tool."
    }
  ],
  "critique_of_the_criteria": "Criterion 4 (land-grab timing on an unclaimed surface) is in real tension with criterion 3 (own-problem, individual-dev pain) for this specific angle: the generalist agent-observability surface that would satisfy 'own problem, runs locally, huge audience' is precisely the surface that Langfuse and Opik have already claimed at 20-27k stars each, in under two years. What's left unclaimed for a LangGraph practitioner are narrow verticals (loop-detection, portable offline recording, statistical trajectory testing) that are structurally lower-ceiling than a generalist platform, because a single-function utility converts fewer installs into stars — most people pip-install a linter-shaped tool, get value once, and never think to star it, versus a platform they open daily and evangelize. I'd also push on criterion 3 itself: for an infrastructure/production engineer, the line between 'my own problem' and 'my employer's problem' is genuinely blurry — a tool that stops a runaway LangGraph loop protects the engineer's own sleep AND the company's AWS bill simultaneously; that dual nature is probably a feature of this angle, not a bug, and the criteria don't have language for it. Finally, criterion 1 ('works offline or with a single API key') pulls against statcheck's actual mechanism — meaningfully testing non-determinism requires sampling a real model N times, so 'fully offline with zero setup' and 'test the thing that's actually non-deterministic' are in tension unless the tool defaults hard to a local model, which I've noted as a real risk rather than resolved cleanly.",
  "top_pick": "flightdeck. It's the most direct hit on the author's actual expertise (he already understands LangGraph's checkpoint/state model cold from shipping it to Bedrock/AgentCore in production), it answers two of the brief's named pains at once (non-deterministic debugging AND local reproduction of a prod failure), and the demo — dragging a time-travel slider and watching state rewind in a browser with zero network calls — is the single most GIF-able thing in this entire set. It's also the idea most likely to survive contact with reality: even in a world where LangChain eventually ships a local-only mode for `langgraph dev`, the portable single-file model (email me your .flight file) is a genuinely different, still-useful product shape that a generic 'local dev server' doesn't replace.",
  "schema_version": 3
}
```

# Itch's Brainstorm: LangGraph Practitioner Pain, Mined From The Field

## Where this came from

The brief for this seat was narrow on purpose: don't imagine pain, go find it. What follows is what actually turned up across GitHub issues, Hacker News, and dev blogs when I went looking for what people who ship LangGraph agents complain about on a normal Tuesday. Three real, cited complaints, verbatim:

1. From an Ask HN thread on LLM observability platforms (news.ycombinator.com/item?id=45716518), the original poster, **seany62**, describing three failed vendor attempts to get one simple thing: _"Log an LLM completion, and be able to press a button that lets us re-run the exact same completion in a UI"_ — and explicitly _not_ wanting "datasets," "scores," or "prompt enhancers," the exact feature set most observability platforms lead with.

2. From a dev.to post by a developer who open-sourced a tool after a production incident (dev.to/hidai25/my-ai-agent-cost-me-400-overnight-so-i-built-pytest-for-agents-and-open-sourced-it-492c): _"agents that work perfectly on your local machine will absolutely betray you in production"_ — the specific trigger was one agent calling the same tool 47 times in a loop overnight, and: _"You don't find out until a user complains. Or until you check your billing dashboard and feel your stomach drop."_

3. From the reaction when LangSmith's free tier changed, summarized across secondary sources citing the original r/LangChain thread: the top reply was _"We self-host Langfuse and are pretty happy so far,"_ with another commenter calling free self-hosting _"a key requirement."_ This is corroborated by LangSmith's own current pricing — $39/seat before a single trace is logged, then $2.50-5.00 per 1,000 traces in overage — which is the concrete number behind why people flee to self-hosted alternatives.

On top of the quotes, three verified technical facts did a lot of work in shaping these ideas:

- **`langgraph dev`, the officially recommended local development path, serves its Studio UI from `https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024`.** Even when your agent server is 100% local, the UI you use to inspect it loads from LangChain's own cloud domain. The prior standalone desktop app (`langchain-ai/langgraph-studio`, Mac-only Electron) has been deprecated in favor of this. There is currently no first-party, fully offline, cross-platform graph inspector.
- **LangGraph has a documented infinite-tool-loop failure mode**: when `bind_tools()` sends the tools parameter on every request and a model keeps re-calling the same tool after a `ToolMessage` instead of stopping, the only backstop is the blunt, semantics-blind `recursion_limit` (default 25 steps), which raises `GraphRecursionError` on total step count, not on detecting "you just called the same tool with the same arguments three times in a row."
- **Two people have already tried to build a VCR-style deterministic replay tool for LangChain/LangGraph testing** — `vcr-langchain` (82 stars, stalled) and `langchain-replay` (1 star) — and both sit at trivial star counts despite solving a real, named pain. That's a genuine yellow flag I'm reporting honestly rather than hiding: this pain is real, but two prior attempts to monetize it in stars have not broken out.

## The landscape check

The generalist "agent observability platform" category is not an opportunity, it's a graveyard for new entrants: Langfuse sits at 27.5k stars (MIT, free self-host, YC W23), Opik went from zero to roughly 20k stars in under two years including a stretch of 0→12.5k in about eight months, Arize Phoenix is at ~10.7k, Helicone ~5.8k, AgentOps 5.5k, and even W&B's own Weave — from a company with enormous distribution — sits at only ~1.1k, which is itself a useful data point: distribution and brand don't automatically win this fight either. Anything shaped like "a local LangSmith" is dead on arrival against that lineup, which is why none of the six ideas above are that.

Where I found genuine daylight is narrower: nobody owns "portable, single-file, zero-network-call flight recorder," nobody owns "pre-emptive semantic loop breaker" as opposed to post-hoc cost monitoring, and nobody owns "statistical/property-based assertions for agent trajectories" as a framing distinct from both deterministic replay and LLM-as-judge scoring. Those narrower surfaces are also, honestly, lower-ceiling — that trade-off is real and I've tried not to paper over it in the star estimates above.

## Enumeration against the brief's eight pain categories

- Debugging a non-deterministic multi-step graph → **flightdeck**
- Why did my agent do that? Attribution across a trace → **flightdeck** (time-travel + state diff)
- Tests for something that never returns the same output twice → **pytest-langgraph** (deterministic path) and **statcheck** (statistical path) — deliberately proposed both because they solve genuinely different sub-problems, not because I couldn't decide.
- Token/cost surprises discovered after the fact → **loopguard**
- Prompt and graph versioning: what changed between the run that worked and the one that didn't → **graphdiff**
- Local reproduction of a failure that happened once in production → **flightdeck**
- Context window management and what actually got sent to the model → **contextsent**
- Tool-calling that silently does the wrong thing → addressed and then killed as a standalone idea (folded into `ideas_i_killed`) because `langchain-ai/agentevals` already owns that surface as an official first-party repo.

All eight categories from the brief are covered by name; nothing was silently dropped.
