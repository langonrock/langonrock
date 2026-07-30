# Council — langonrock: construir uma camada sobre LangChain para deployar na AWS/Bedrock?

**Modo:** verdict (convergir) · **Juízes:** 5 · **Rodadas:** 1 (sem `--adversarial`) · **Data:** 2026-07-30
**Veredito de consenso: FAIL** (4 FAIL + 1 WARN; regra: qualquer FAIL → FAIL)

| Juiz           | Perspectiva                                | Veredito | Confiança |
| -------------- | ------------------------------------------ | -------- | --------- |
| **Landscape**  | o que já existe                            | FAIL     | HIGH      |
| **CTO**        | qualidade da aposta, custo de oportunidade | FAIL     | MEDIUM    |
| **Staff**      | custo real de construir e manter           | FAIL     | HIGH      |
| **Contrarian** | melhor caso A FAVOR de construir           | **WARN** | MEDIUM    |
| **Adoption**   | quem usa e o que impede                    | FAIL     | HIGH      |

---

## 1. O que a análise anterior errou

O briefing entregue ao conselho continha minha primeira resposta como hipótese a ser atacada. Os juízes derrubaram cinco pontos dela. Todos verificados de forma independente antes de entrarem aqui.

**Terraform não é uma lacuna.** Eu disse que a CLI é CDK-first com Terraform "em breve" e tratei isso como janela de oportunidade. Falso como afirmação sobre o AgentCore em geral: o provider oficial `hashicorp/aws` já traz recursos nativos `aws_bedrockagentcore_*` (release v6.57.0/6.57.1 em 2026-07-29), e a própria AWS publica o módulo `aws-ia/terraform-aws-agentcore` no Terraform Registry cobrindo Runtime, Memory, Gateway, Browser, Code Interpreter, IAM, VPC e builds ARM64 via CodeBuild. O "em breve" vale só para o backend interno da CLI. A fonte que citei (dev.to) é de março de 2025 e antecede a existência da própria `agentcore-cli`.

**O "golden path interno" — que eu apontei como a aposta mais provável — já existe.** `awslabs/fullstack-solution-template-for-agentcore` ("FAST"): 560 estrelas, criado em janeiro de 2026, com push no mesmo dia desta análise. Traz escolha entre CDK e Terraform, convenções de VPC/IAM/tagging, auth via Cognito com OAuth2 M2M, controle de acesso por políticas Cedar no Gateway e um pattern `langgraph-single-agent` funcionando. É exatamente o artefato que eu recomendei construir do zero.

**"A CLI é centrada na máquina do dev" está desatualizado.** A `agentcore-cli` já tem targets de deploy nomeados (`aws-targets.json`, `deploy --target`), config bundles versionados com linhagem de branch e diffáveis, e `run ab-test` / `promote ab-test` — rollout com gate em resultado de avaliação online. As primitivas de promoção existem; o que não existe é o pipeline que as costura.

**IAM já vem resolvido.** A CLI publica três documentos de política least-privilege prontos (`iam-policy-user.json`, `iam-policy-cfn-execution.json`, `iam-policy-boundary.json`) com separação documentada entre credencial do dev e role de execução do CloudFormation. Reimplementar isso não é trabalho neutro: política de IAM que desatualiza é bug de segurança.

**Faltou um concorrente inteiro.** A própria LangChain vende o produto de deploy para agentes LangGraph: LangSmith Deployment e LangSmith Fleet. Uma camada "em cima do LangChain" compete com quem faz o LangChain, não só com a AWS.

Correção menor: o `EXPORT_NOTES.md` que citei como atrito pertence ao caminho declarativo `export harness` (que exporta para um agente Strands), não ao fluxo `agentcore create --framework LangChain_LangGraph` que um agente LangGraph escrito à mão usaria.

E a esteira de versões é assimétrica, não simétrica como eu descrevi: LangChain 1.x / LangGraph 1.x são GA desde outubro de 2025 com política declarada de nenhuma quebra até o 2.0. Praticamente todo o churn está do lado do AgentCore.

---

## 2. O contra-argumento que sobreviveu

O juiz Contrarian foi o único a divergir, e trouxe evidência que ninguém mais tinha. Ele não defende construir a camada genérica — defende que meu retrato da `agentcore-cli` como padrão consolidado está errado.

**A CLI é pré-1.0.** npm `latest` = 0.25.0, canal `preview` = 1.0.0-preview.24. Seis meses de idade (criada em 2026-01-26). 232 estrelas contra 181 issues abertas. E o toolkit "legado" que ela substitui ainda tem mais estrelas (499) e continua recebendo commits: o ecossistema não terminou de migrar para a ferramenta que a AWS quer que todo mundo use.

**Bugs abertos que não são arestas.** Verificados no issue tracker:

| Issue                                                                                                                 | Problema                                                                                                                                                | Por que importa                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#1673](https://github.com/aws/agentcore-cli/issues/1673)                                                             | `deploy` cria credential provider OAuth2 fora da stack do CloudFormation; `remove all` nunca apaga                                                      | Conta AWS tem teto de 50 providers. Ciclos normais de dev/CI acumulam órfãos até **todo** deploy OAuth da conta falhar, inclusive de projetos não relacionados |
| [#870](https://github.com/aws/agentcore-cli/issues/870)                                                               | Não há como usar uma role IAM pré-existente. Editar `roleArn` no `agentcore.json` passa no `validate` e é **silenciosamente ignorado** no deploy        | Um controle de segurança que falha em silêncio é pior que um que dá erro. Time acha que aplicou least-privilege e não aplicou                                  |
| [#1472](https://github.com/aws/agentcore-cli/issues/1472)                                                             | Observabilidade padrão gera 4 métricas por chamada de API distinta via CloudWatch Application Signals, sem forma suportada de desligar mantendo tracing | Custo não divulgado que escala com uso                                                                                                                         |
| [#1735](https://github.com/aws/agentcore-cli/issues/1735) / [#1799](https://github.com/aws/agentcore-cli/issues/1799) | `deploy --target` descreve stacks de todos os targets; nome da stack de bootstrap do CDK é hard-coded                                                   | Justamente o multi-env: existe, mas ainda quebrado                                                                                                             |

**Precedente de churn da própria AWS.** O AWS Copilot CLI — CLI opinativa de deploy para ECS/Fargate — chegou a fim de suporte em 2026-06-12, e a orientação da AWS é migrar para Terraform/CDK cru ou para o ECS Express Mode. Some a isso o `bedrock-agentcore-starter-toolkit` declarado legado em cerca de um ano. Duas gerações de CLI de deploy opinativa da AWS descontinuadas ou substituídas em menos de dois anos. "A AWS já entrega" não é o mesmo que "a AWS vai continuar entregando nesta forma".

**A contra-resposta dos outros juízes:** esse repo fecha issues rápido (~405 fechadas contra 181 abertas em seis meses). Código escrito para desviar dos bugs de hoje vira código morto no próximo trimestre. A tensão fica registrada sem resolução — é o ponto genuinamente em aberto desta análise.

---

## 3. Os quatro candidatos, revisados

| Candidato                 | Lacuna real hoje?                                                                                                                                                             | Veredito                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Terraform**             | Não. Provider nativo + módulo `aws-ia` já cobrem. A lacuna estreita que resta: empacotar um agente LangGraph no formato de container que o recurso `runtime` do módulo espera | Adotar `aws-ia/agentcore/aws`. Não construir                                             |
| **Golden path interno**   | Não, como construção do zero. O FAST já entrega                                                                                                                               | Forkar o FAST e podar. Não construir                                                     |
| **CI/CD multi-ambiente**  | **Sim.** O exemplo oficial da AWS com GitHub Actions é single-env, sem promoção, gate ou rollback. Os workflows do FAST são lint e security scan do próprio template          | Único alvo legítimo. Template interno, 300–800 linhas majoritariamente YAML, 1–2 semanas |
| **Shim de portabilidade** | Não, e é uma armadilha                                                                                                                                                        | Matar                                                                                    |

Sobre o shim, o juiz Staff foi específico sobre por que não fecha: o AgentCore dá a cada sessão um microVM com `idleRuntimeSessionTimeout` que reseta por invoke **e** um teto rígido de 8h de `maxLifetime`, mais storage de sessão gerenciado (1GB/14 dias) ou EFS/S3 montado via NFSv4.1. Lambda tem teto de 15 minutos e nenhum conceito nativo de sessão longa. ECS puro não tem nem o isolamento por sessão nem os timers. Uma abstração sobre isso ou achata para o menor denominador comum (sem estado de sessão persistente, sem sessões longas) ou vira três implementações independentes atrás de uma interface. 6–10 semanas para uma versão de dois alvos, contra uma necessidade que ninguém confirmou.

---

## 4. Veredito por cenário

| Cenário                                                          | Veredito                                       | O que fazer                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **OSS / produto para terceiros**                                 | **FAIL unânime** (5/5, incluindo o Contrarian) | Não fazer. Pinça de dois incumbentes de primeira parte: AWS (`agentcore-cli`, funil dos docs e do re:Invent) e LangChain (LangSmith Deployment/Fleet, funil dos docs do LangGraph). Nenhuma das condições que fizeram camadas de terceiros vencerem historicamente — first-mover como o Serverless Framework, necessidade multi-cloud real como o Terraform, ou anos de investimento dedicado como o SST — está presente |
| **Interno, 1 agente, time pequeno**                              | FAIL a WARN                                    | README + Makefile fixando as invocações e os valores da org (conta, VPC, ARNs de role, tags). Não uma biblioteca. Deploy de um agente é evento de baixa frequência; abstração mantida não se paga, e cria bus factor de um                                                                                                                                                                                               |
| **Interno, 2+ agentes ou 2+ times, atrito recorrente observado** | WARN                                           | Aí sim o template de promoção multi-ambiente. Repo de template, dias a duas semanas, chamando a CLI por fora — nunca reimplementando o que ela faz                                                                                                                                                                                                                                                                       |
| **Multi-cloud confirmado (contratual/regulatório)**              | Dividido                                       | Contrarian: PASS para um adaptador estreito. Landscape: WARN, escopo no segundo runtime nomeado. Staff: FAIL — escreva três caminhos de deploy honestos em vez de uma abstração que esconde diferenças reais. Nenhum juiz defende um shim genérico de N runtimes                                                                                                                                                         |

Uma nota do CTO que corta transversalmente: o lock-in do AgentCore é incorrido no momento em que você escolhe rodar no AgentCore. Ele é idêntico com ou sem a `langonrock` por cima. Uma abstração no lado do deploy não desfaz lock-in de runtime — só adiciona um segundo artefato para manter. A defesa barata é arquitetural: manter as integrações específicas do AgentCore (`AgentCoreMemorySaver`, tools nativas) atrás de adaptadores finos no código do próprio agente, para que o grafo LangGraph não importe classes AgentCore diretamente. Horas de disciplina, não semanas de tooling.

---

## 5. Recomendação

**Não construir a `langonrock` como camada ou biblioteca.** Ordem de adoção:

1. `agentcore create --framework LangChain_LangGraph`, usando os JSONs de política do `docs/PERMISSIONS.md` da própria CLI, sem alterações.
2. Forkar o **FAST** como esqueleto de golden path em vez de escrever um. Podar o frontend se não for um webapp; manter as convenções de IAM/VPC/tagging.
3. Se Terraform for o padrão de IaC da org, `aws-ia/agentcore/aws` direto.
4. Antes de decidir qualquer coisa, reproduzir os cinco bugs verificados (#1673, #870, #1472, #1735, #1799) contra o agente real. Se algum bloquear um requisito concreto — role IAM mandatória por compliance, auth CUSTOM_JWT, previsibilidade de custo — construir só aquela guarda, dimensionada em dias.
5. Só depois, e só se o atrito se repetir entre dois ou mais agentes/times, o workflow de promoção multi-ambiente.

O experimento que decide tudo isso custa um dia e ainda não foi feito. O repo está vazio.

---

## 6. Perguntas em aberto que mudam a resposta

> **Resolvido em 2026-07-30, após o conselho:** o autor confirmou que o projeto será **OSS**. Isso seleciona o cenário de veredito unânime FAIL (5/5) da seção 4. As linhas "interno" abaixo e na seção 4 ficam registradas como contexto da deliberação, não como caminho disponível. A pergunta decisiva restante passa a ser a #2 (o agente já existe, e em quê), que define se sobra alguma fatia OSS defensável — ver seção 7.

Ordenadas por quanto movem o veredito:

1. ~~**Interno ou OSS/produto?**~~ → **resolvido: OSS.** Move de "README e Makefile" para "não fazer, unanimemente".
2. **O agente já existe, e em quê?** O pedido literal foi "deployar _o_ agent". Se ele já existe em LangGraph, a lacuna mais próxima do pedido não é deploy genérico — é brownfield: o `create` da CLI é orientado a greenfield e a [#1726](https://github.com/aws/agentcore-cli/issues/1726) confirma que não dá para alterar a config de um agente depois de criado. O caminho documentado pela AWS para um agente LangGraph existente é manual (importar `BedrockAgentCoreApp`, envolver com `@entrypoint`, containerizar, atualizar `.bedrock_agentcore.yaml`, `cdk deploy`). Isso pode ser uma conversão única, sem ferramenta reutilizável nenhuma.
3. **Quantos agentes/times, em qual cadência?** Abaixo de 2+, nada persistente se justifica.
4. **Multi-cloud é requisito real ou hedge?** Único gatilho que abre o tópico portabilidade, e ainda assim com escopo em um segundo runtime nomeado.

---

## 7. Adendo: o caminho OSS, se houver um

Confirmado que o projeto é OSS, a proposta **como escopada** ("uma camada sobre LangChain para deployar na AWS/Bedrock") está morta pelo veredito unânime. O que muda o cálculo não é otimismo — é mudar a _forma_ do artefato de **concorrente** da `agentcore-cli` para **complemento** dela.

A distinção estrutural: uma ferramenta que reimplementa `create`/`deploy`/`invoke` compete com um time da AWS que mergeia ~50 mudanças por mês. Uma ferramenta que _chama_ a `agentcore-cli` e preenche uma costura que ela não cobre herda o trabalho da AWS em vez de correr contra ele. Só a segunda forma sobrevive à análise das seções 1–4.

Duas costuras não ocupadas, ambas apontadas por mais de um juiz:

**A. Brownfield: repo LangGraph existente → artefatos que o AgentCore espera.**
O `agentcore create` é orientado a greenfield, e a [#1726](https://github.com/aws/agentcore-cli/issues/1726) confirma que não dá para alterar a config de um agente depois de criado. O caminho documentado pela AWS para um agente LangGraph que já existe é receita manual: importar `BedrockAgentCoreApp`, envolver com `@entrypoint`, containerizar, atualizar `.bedrock_agentcore.yaml`, `cdk deploy`. Ninguém automatizou isso. É também a leitura mais literal do pedido original ("deployar _o_ agent").

**B. Promoção multi-ambiente como GitHub Action reutilizável.**
Única lacuna que os cinco juízes concordaram ser real. O exemplo oficial da AWS é single-env; os workflows do FAST são lint e security scan do próprio template. Como OSS: uma composite action que usa GitHub Environments (gates de aprovação, secrets por ambiente) sobre as primitivas que já existem — `deploy --target`, config bundles, `promote ab-test`. Superfície pequena, manutenção baixa por não reimplementar nada.

As duas convergem no mesmo enunciado: **empacotar um app LangGraph no formato que o AgentCore consome, desacoplado de quem dirige o deploy** (CLI, o módulo `aws-ia` do Terraform, ou CI). Essa terceira propriedade é a que a seção 3 identificou como a lacuna estreita restante do lado Terraform.

**O que continua valendo contra, mesmo nessa forma:**

- Previsão do juiz Adoption para qualquer OSS nessa categoria: estrelas em dois dígitos baixos em 6 meses, zero contribuidores fora do autor em 12. Nenhuma evidência de vencedor de terceira parte nessa categoria hoje.
- A costura A fecha no momento em que a AWS resolver a [#1726](https://github.com/aws/agentcore-cli/issues/1726) e adicionar um fluxo de import brownfield. É plausível dentro de um ou dois trimestres.
- O nome `langonrock` amarra a identidade a um framework e uma cloud, contra a tese explícita de agnosticismo do próprio AgentCore (Strands, LangGraph, Google ADK, OpenAI Agents, CrewAI, LlamaIndex). Para interno seria irrelevante; para OSS é contraposicionamento.

**Pré-condição inegociável:** nada disso é decidível sem rodar o experimento de um dia. Empacotar o agente real à mão pelo caminho manual da AWS é o que revela se a costura A tem substância ou se são vinte linhas de boilerplate que ninguém precisa de ferramenta para escrever.

---

## Fontes

Verificadas em 2026-07-30 via GitHub API, Terraform Registry e npm registry, além das buscas dos juízes.

- https://github.com/aws/agentcore-cli — 232 estrelas, 181 issues abertas, criado 2026-01-26, push em 2026-07-30
- npm `@aws/agentcore` — `latest: 0.25.0`, `preview: 1.0.0-preview.24` (pré-1.0 confirmado)
- https://github.com/aws/bedrock-agentcore-starter-toolkit — 499 estrelas, ainda com push em 2026-07-29 apesar de legado
- https://github.com/awslabs/fullstack-solution-template-for-agentcore — 560 estrelas, push em 2026-07-30
- https://github.com/aws-ia/terraform-aws-agentcore — 24 estrelas, push em 2026-04-30 (módulo pequeno e três meses atrás do surface atual da CLI)
- https://registry.terraform.io/modules/aws-ia/agentcore/aws/latest
- https://github.com/hashicorp/terraform-provider-aws/releases/tag/v6.57.0
- https://github.com/langchain-ai/langchain-aws — só SDK, zero superfície de deploy
- https://www.langchain.com/langsmith — LangSmith Deployment / Fleet
- https://aws.amazon.com/blogs/containers/announcing-the-end-of-support-for-the-aws-copilot-cli
- https://aws.amazon.com/blogs/machine-learning/deploy-ai-agents-on-amazon-bedrock-agentcore-using-github-actions — exemplo oficial single-env
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-lifecycle-settings.html — teto de 8h de `maxLifetime`

**Análises individuais:** `2026-07-30-validate-langonrock-claude-{landscape,cto,staff,contrarian,adoption}.md`
