# Council Brainstorm — o que construir em OSS de agents para ganhar stars

**Modo:** brainstorm (divergir) · **Juízes:** 5 · **Ideias geradas:** 31 · **Ideias mortas com evidência:** 44 · **Data:** 2026-07-30

Sem veredito PASS/WARN/FAIL — brainstorm produz conjunto ranqueado, não julgamento.

| Juiz           | Ângulo                                          | Ideias | Escolha       |
| -------------- | ----------------------------------------------- | ------ | ------------- |
| **Wide**       | mapear todo o espaço de opções                  | 7      | TarefasBR     |
| **Demo**       | o que vira vídeo de 15s que estranho reposta    | 6      | AgentDuel     |
| **Itch**       | dor real de quem shippa LangGraph todo dia      | 6      | flightdeck    |
| **Timing**     | que superfície está aberta agora, julho de 2026 | 6      | agentgraph    |
| **Contrarian** | o que os outros quatro vão errar                | 6      | agente-fiscal |

Todos os números de estrelas abaixo foram reverificados pela orquestração via GitHub API em 2026-07-30.

---

## 1. As três descobertas que valem mais que qualquer ideia da lista

### O enxame é mais rápido que a janela

O juiz Timing mediu o que ninguém tinha medido: a spec MCP 2026-07-28 foi finalizada **dois dias** antes desta análise. Uma busca por repos criados desde então retornou **mais de 20 tentativas quase idênticas** de scanner de migração — `mcp-herald`, `mcpfit`, `mcp-upgrade`, `mcp-vet`, `mcp-2026-validator`, `mcp-2026-migrate`, `mcp-stateless-conformance` — todas com 0 a 3 estrelas, quase todas de autores solo desconhecidos, várias plausivelmente geradas por agente em uma tarde.

O mesmo padrão apareceu em outros três nichos: detecção de conflito entre skills (15+ entrantes), spend-guards x402 (15+ entrantes), playgrounds MCP no browser (7+ produtos).

Ser cedo deixou de ser suficiente. Agora é preciso ser primeiro dentro de um enxame simultâneo, e a maioria do enxame é gerada por IA em horas. **Isso adiciona um sexto critério: resistência a enxame** — a ideia exige engenharia cara o bastante para que um clone da mesma semana seja inviável? Um wrapper de CLI em cima de um regex não tem. Um sandbox, um engine de grafo ou um parser multi-formato têm.

### O playbook está saturado exatamente porque é o playbook certo

O juiz Wide varreu sete categorias e matou 15 ideias, cada uma com 2 a 6 concorrentes vivos. Seis linters de SKILL.md. Cinco scanners de segurança MCP. Cinco profilers de custo de token. Seis ferramentas de sincronizar regras entre agents. Quatro scanners de qualidade de descrição de tool.

A conclusão dele é desconfortável e provavelmente certa: se os cinco critérios são o playbook ótimo, **todo mundo que aplica o playbook converge nas mesmas formas ao mesmo tempo**. A corretude do critério é o que causa a saturação. "Land-grab timing" se autodestrói em escala.

### Os critérios descrevem um gênero, não uma lei

O Contrarian achou o contra-exemplo mais forte possível dentro do próprio top 10 do GitHub: **`sindresorhus/awesome` tem 490.673 estrelas e é um arquivo markdown**. Nunca "rodou" em nenhum sentido do critério 1. `system-design-primer` tem 359k. `coding-interview-university`, 357k.

Pior: os dois exemplos que o próprio briefing citou como prova do critério não passam nele. Dify precisa de 20 a 30 minutos de setup em servidor limpo e uma chave de provider antes de fazer qualquer coisa além de renderizar um canvas vazio. Langflow, idem.

Se os dois expoentes de um critério não passam no critério, ele descreve uma preferência de gênero — ferramenta instalável com momento de "uau" — não um portão que toda ideia vencedora precisa cruzar.

---

## 2. Duas descobertas menores que mudam decisões

**O teste do segundo uso (Demo).** O juiz Demo gerou o TokenBloom — arte generativa a partir do stream de tokens — pontuou 5 em demo e 1 em utilidade, e denunciou a própria ideia: um GIF viral em volta de ferramenta oca rende estrelas que decaem. Falta um critério: **o segundo uso produz valor novo, ou tudo já foi gasto na primeira visualização?**

**Abandono vale mais que terreno virgem (Contrarian).** Verificado: `SuperAGI` tem 17.648 estrelas e nenhum commit desde 2025-01-22. `Local-File-Organizer` tem 3.305 estrelas e está parado desde 2024-10-21. Demanda real, comprovada, deixada na mesa por atrito — não por ausência de primeiro entrante. **"Segundo mas mantido" ganha de "primeiro mas abandonado."**

Um caso que os juízes não exploraram e que a orquestração encontrou ao verificar: **`xigua-wang/skill-doctor`, o líder de inspeção de skills com 321 estrelas, está sem push desde 2026-04-22** — três meses parado. Isso fortalece diretamente o `clawpreview` abaixo.

---

## 3. A descoberta que ninguém pediu: stars não medem o que você acha

O Contrarian trouxe a evidência mais desconfortável do conselho:

- **Hermes Agent ultrapassou o OpenClaw em volume diário de tokens no OpenRouter em maio de 2026** (224B contra 186B por dia) tendo cerca de metade das estrelas acumuladas. Uso real e estrelas divergem e chegam a inverter.
- A Bessemer rastreia **contribuidores únicos mensais** em vez de estrelas, porque menos de 5% dos 10 mil maiores projetos do GitHub passam de 250 contribuidores mensais e só 2% sustentam isso por seis meses. Engajamento é quase impossível de falsificar; um clique em estrela não é.
- Existe mercado cinza documentado de venda de estrelas operando abertamente em Fiverr e Telegram. _(O Contrarian não conseguiu carregar o PDF acadêmico primário e sinalizou isso explicitamente em vez de lavar a fonte secundária — mantenho a ressalva dele.)_

Implicação prática para este relatório inteiro: **todo número de estrela citado aqui, inclusive nas comparações de concorrentes, deve ser lido como "estrelas reportadas", não como adoção orgânica verificada.**

---

## 4. Ranking consolidado

Ordenado por resultado ajustado ao risco, com os dois critérios novos aplicados.

| #   | Ideia                         | Juiz              | Faixa 12m | Resistência a enxame                              | Valor no 2º uso      | Risco principal                                   |
| --- | ----------------------------- | ----------------- | --------- | ------------------------------------------------- | -------------------- | ------------------------------------------------- |
| 1   | **agentgraph**                | Timing            | 500–3.000 | **Alta** — parser multi-formato + engine de grafo | Alto — vira hábito   | `claude-code-trace` (356★) senta nos mesmos logs  |
| 2   | **clawpreview**               | Timing            | 600–2.500 | **Alta** — sandbox é engenharia real              | Alto                 | Skill que detecta sandbox e finge inocência       |
| 3   | **flightdeck**                | Itch              | 800–2.500 | Média                                             | Alto                 | LangChain shippar modo offline no `langgraph dev` |
| 4   | **AgentDuel**                 | Demo              | 700–3.500 | Baixa — wrapper de CLIs                           | Médio                | Windsurf e Qwen já shipparam arena nativa         |
| 5   | **TarefasBR / agente-fiscal** | Wide + Contrarian | 150–1.200 | **Máxima** — ativo não clonável                   | Alto                 | Teto de audiência estrutural                      |
| 6   | **repo-trailer**              | Wide              | 400–1.500 | Baixa — VHS + heurística                          | Baixo — roda uma vez | "Inferir comando de first-run" erra muito         |
| 7   | **loopguard**                 | Itch              | 400–1.200 | Baixa                                             | Médio                | Correção de dois dias upstream mata a premissa    |
| 8   | **AgentTrust**                | Contrarian        | 200–4.000 | Alta                                              | Alto                 | Guerra política de "esse benchmark é justo?"      |

### As quatro primeiras, em detalhe

**agentgraph** — Transforma todo o histórico de sessões locais (`~/.claude/projects/*.jsonl`, store do OpenClaw) num grafo consultável offline: nós para sessões, tool calls, skills, arquivos, erros; arestas para causou, tocou, falhou-com. `npx agentgraph query "skill=deploy status=failed"`, zero chamada de LLM.

A tese: **`Graphify-Labs/graphify` tem 99.008 estrelas, criado em 2026-04-03** — quatro meses — com exatamente o pitch "transforme X num grafo local determinístico, sem vector store". O agentgraph aponta esse mecanismo validado para um corpus que o Graphify não toca: a memória do seu próprio agent sobre si mesmo. Não é clone frontal, e exige engenharia real, o que filtra o enxame.

**clawpreview** — Pega uma URL de skill, roda num sandbox isolado de rede contra uma tarefa representativa, e devolve um replay estilo asciinema: cada arquivo lido e escrito, cada comando shell, cada chamada de rede, diffável contra baseline limpa.

O diferencial é não classificar. A pesquisa ToxicSkills da Snyk afirma que **todo scanner público testado é contornado em menos de uma hora** — padding de payload, lógica escondida em binário, prompt injection no próprio LLM juiz. O clawpreview não pontua: roda uma vez numa caixa que você não liga e mostra a fita. Isso desvia da corrida armamentista em vez de entrar nela. E o líder atual da categoria está parado há três meses.

**flightdeck** — Wrapper de checkpointer que grava toda run num único arquivo SQLite portátil. `scp` do pod de produção, anexa numa issue, abre no laptop, sem rede. UI local com scrub de time-travel e diff de state entre checkpoints.

Achado que sustenta a ideia: **`langgraph dev`, o caminho local oficialmente recomendado, serve a Studio UI a partir de `https://smith.langchain.com/studio/`** — mesmo com o servidor 100% local, a UI carrega do domínio de nuvem da LangChain. Não existe inspetor de grafo first-party totalmente offline. Contra: Langfuse (32.179★) e Opik (20.992★) dominam a categoria e ambos tiveram push hoje.

**AgentDuel** — Duas CLIs de coding agent correndo a mesma tarefa em worktrees isolados, split pane ao vivo, placar no fim, GIF automático na saída. Melhor demo do conselho inteiro. Mas é o candidato com pior resistência a enxame e maior risco de absorção: Windsurf já tem Arena Mode nativo e o Qwen Code tem Agent Arena.

---

## 5. A convergência que vale registrar

**Dois juízes chegaram ao Brasil de forma independente e por caminhos opostos.** O Wide varreu sete categorias procurando qualquer lacuna e o único lugar onde a busca por concorrente voltou vazia foi um benchmark agêntico de tarefas brasileiras. O Contrarian sondou deliberadamente o ângulo não-anglófono e chegou a um MCP server de Open Finance, Pix e NFe. Nenhum dos dois via o outro.

A honestidade dos dois merece registro: o Contrarian **não** vendeu terreno virgem. Ele achou quatro concorrentes reais, incluindo `codespar/mcp-dev-latam` com 265 estrelas e push em 2026-07-16, e reposicionou a tese de "ninguém fez" para "profundidade num país vence largura em seis" — porque ninguém fez os 20% difíceis: o handshake de certificado do Open Finance Brasil, as máquinas de estado de NFe/NFS-e, a lógica de reconciliação que junta os dois.

O argumento estrutural é o mesmo nos dois: ler documentação de Banco Central e SEFAZ em português e ter vivido a dor de reconciliar Pix contra nota emitida é um ativo de informação e empatia que um concorrente anglófono não replica rápido. É a única ideia do conselho cujo fosso não é esperteza.

O custo é honesto: teto de 150 a 1.200 estrelas. É o menor da lista.

---

## 6. As alternativas que não são "construir uma ferramenta"

O Contrarian gerou uma por premissa atacada. Duas merecem consideração real:

**Dez coisas pequenas em vez de uma grande.** Shippar uma ferramenta pequena, completa e demonstrável por semana durante dez semanas, postar uma vez, seguir adiante independente da recepção. Depois dedicar o trimestre seguinte àquela que mostrou tração orgânica. O argumento: a primeira aposta dele (langonrock) já falhou por unanimidade num conselho anterior, o que é evidência direta de que a acurácia do palpite a priori é baixa. Substitui um palpite não testado por dez experimentos baratos. O análogo funcional é Simon Willison (`simonw/llm` 12.265★, `simonw/datasette` 11.324★), que shippa continuamente e deixa a atenção se concentrar sozinha.

Contra: dez trocas de contexto em dez semanas combinam mal com o estilo cuidadoso e cirúrgico que o CLAUDE.md dele descreve.

**Virar co-mantenedor de fato do `langchain-aws` ou do `agentcore-cli`.** Ambos com backlog visivelmente maior que a banda de manutenção: 103 e 181 issues abertas contra 335 e 232 estrelas. Perfil clássico de projeto que recebe bem contribuidor externo competente e consistente. Zero estrelas em algo próprio, por construção — mas possivelmente mais capital de carreira por hora que um repo de poucos milhares de estrelas.

O Contrarian sinalizou o problema honestamente em vez de esconder: **contradiz a letra do pedido.** Se o que ele quer é a sensação de ter construído algo próprio, esse caminho não entrega isso, por melhor que seja a matemática.

---

## 7. Recomendação

Se o objetivo é o maior número realista de estrelas: **agentgraph** ou **clawpreview**. Ambos têm fosso de engenharia que sobrevive ao enxame, ambos ficam em categorias com demanda comprovada, ambos passam no teste do segundo uso. O agentgraph reaproveita o mecanismo mais validado que a pesquisa encontrou; o clawpreview tem a melhor demo e um ciclo de notícias fazendo o marketing.

Se o objetivo é posição defensável que ninguém tira: **a jogada brasileira**, com teto baixo e assumido.

Se ele reconhece que escolher ideia não é o forte dele: **cinco a dez coisas pequenas**, deixando o comportamento de estranhos decidir.

E vale encarar o achado da seção 3: se "stars" é proxy de credibilidade e capital de carreira, o caminho de co-mantenedor pode entregar mais por hora — e não gera estrela nenhuma. Se stars é o objetivo terminal mesmo, ignorar isso é legítimo, mas convém ser deliberado.

---

## Fontes verificadas

GitHub API e npm registry, 2026-07-30, pela orquestração:

| Repo                             | Estrelas | Criado     | Último push             |
| -------------------------------- | -------- | ---------- | ----------------------- |
| `sindresorhus/awesome`           | 490.673  | —          | 2026-06-30              |
| `Graphify-Labs/graphify`         | 99.008   | 2026-04-03 | 2026-07-29              |
| `langfuse/langfuse`              | 32.179   | —          | 2026-07-30              |
| `promptfoo/promptfoo`            | 23.761   | 2023-04-28 | 2026-07-30              |
| `comet-ml/opik`                  | 20.992   | —          | 2026-07-30              |
| `charmbracelet/vhs`              | 20.505   | 2022-07-19 | 2026-07-24              |
| `TransformerOptimus/SuperAGI`    | 17.648   | —          | **2025-01-22 (parado)** |
| `THUDM/AgentBench`               | 3.620    | 2023-07-28 | 2026-02-08              |
| `QiuYannnn/Local-File-Organizer` | 3.305    | —          | **2024-10-21 (parado)** |
| `benchflow-ai/skillsbench`       | 1.605    | 2025-12-29 | 2026-07-23              |
| `paulrobello/claude-office`      | 475      | 2026-01-22 | 2026-07-28              |
| `delexw/claude-code-trace`       | 356      | 2026-03-11 | 2026-07-30              |
| `xigua-wang/skill-doctor`        | 321      | 2026-04-19 | **2026-04-22 (parado)** |
| `codespar/mcp-dev-latam`         | 265      | —          | 2026-07-16              |

Outras: [spec MCP 2026-07-28](https://blog.modelcontextprotocol.io/posts/2026-07-28/) · [Snyk ToxicSkills](https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/) · [Launch-Day Diffusion, arXiv 2511.04453](https://arxiv.org/abs/2511.04453)

**Análises individuais:** `2026-07-30-brainstorm-oss-stars-claude-{wide,demo,itch,timing,contrarian}.md`
