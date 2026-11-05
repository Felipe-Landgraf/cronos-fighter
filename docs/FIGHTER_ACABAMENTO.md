# Acabamento audiovisual do Fighter · 01/11/2026

**Atualização posterior:** [especiais e locução real](FIGHTER_ESPECIAIS_E_LOCUCAO.md). O relatório abaixo registra a primeira entrega; as falas, prioridade de áudio e efeitos especiais foram ampliados depois do retorno da equipe.

## Entrega

O Fighter recebeu efeitos e sons selecionados de **cinco pacotes da comunidade**, mantendo personagens, cenários, menus, controles e regras da v31/Fighter V34.

- Impactos HD brancos/dourados e defesa com anel azul e faíscas.
- Rastros nos quadros ativos dos golpes e poeira breve de avanço/aterrissagem.
- Anéis, brilho e ondas de lançamento dos especiais, com o tempo de cada personagem e suas artes próprias preservados.
- Overlays breves de borda durante contato/especial, com luz por composição no Canvas2D existente.
- Sons diferentes para golpes leves/pesados, bloqueios, movimento, aterrissagem, preparação/lançamento, contagem, início e KO; variação de timbre e posição discreta no estéreo.
- Volume/mute existentes, opção de efeitos reduzidos, fallback visual/sonoro e proteção de saída para sobreposição de sons.

Os recursos adicionais são carregados ao iniciar uma partida do Fighter. Início/Trilhas/Arena/Minigames do Cronos não requisitam esses assets. Não há nova biblioteca de execução nem serviço externo: arquivos locais, renderer e contexto de áudio existentes.

## Fontes e licenças

| Pacote | Seleção utilizada | Licença |
| --- | --- | --- |
| [Combat FX Free — heyheythere](https://heyheythere.itch.io/combat-fx-free) | Quatro folhas de sprites HD de 256 px: impacto, corte, faísca e crítico | CC BY 4.0 |
| [Brackeys' VFX Bundle](https://brackeysgames.itch.io/brackeys-vfx-bundle) | Dois anéis pré-desenhados de CodeManu, distribuídos pelo Brackeys | CC0 |
| [Particle Pack — Kenney](https://kenney.nl/assets/particle-pack) | Poeira e brilho | CC0 |
| [Impact Sounds — Kenney](https://kenney.nl/assets/impact-sounds) | Oito sons de contato/defesa/aterrissagem | CC0 |
| [RPG Audio — Kenney](https://kenney.nl/assets/rpg-audio) | Três sons de movimento/corte | CC0 |

Página de créditos acessível pelo menu **Controles → Créditos e licenças**. Os avisos originais e o manifesto com origem, tamanho e SHA-256 de cada arquivo acompanham `game/public/assets/fighters/polish/`. Ajustes de escala, composição, duração, volume, velocidade e filtros são documentados nos créditos. Os bytes das mídias selecionadas foram preservados.

Foram avaliadas outras coleções; somente recursos efetivamente usados foram incluídos. Downloads inteiros e arquivos de editor permanecem fora do Git, em `.sites-runtime/fighter-polish/downloads/`.

## Peso e execução

| Item | Bytes |
| --- | ---: |
| 19 mídias novas: oito PNG e onze OGG | 915.533 |
| Pasta completa `polish/`, com código, manifesto e licenças | 947.792 |
| Acréscimo do HTML de integração | 6.206 |
| Acréscimo total de arquivos públicos em runtime, sem compressão | **953.998 — aproximadamente 0,95 MB** |

O frontend principal do Cronos manteve seus arquivos de JS/CSS e tamanhos anteriores. Os 182 assets originais do Fighter continuam intactos. Os efeitos usam o RAF e os relógios já existentes; a opção de efeitos reduzidos conserva o contato simplificado. O áudio usa um único contexto por partida, máximo de 12 vozes, descarte ao terminar/pausar e carregamento abortável. O ganho mestre continua seguindo as preferências existentes.

## Proteções e revisão

Checkpoint anterior: commit `bcade07`, tag `checkpoint/fighter-before-polish-20261101`. Cópia/hash local em `.sites-runtime/fighter-polish/before/`. A referência original para os traces é fixada por SHA-256 `cbe5b234f6e3659dc8b240ad940c341bff7325f56bd29e56f3bdb427444c8db1`.

Uma revisão independente identificou e a implementação corrigiu:

- Retorno pelo cache do navegador: `pagehide` preservado pausa, `pageshow` restaura somente a sessão atual, visível, focada e não pausada manualmente. Saída definitiva destrói a sessão.
- Impacto no KO: a animação continua envelhecendo pelo relógio de apresentação quando a simulação já parou.
- Perda de foco durante KO/resultado: sons são interrompidos em qualquer fase, com listeners removidos no descarte.

A medição dos sons detectou saturação no teste extremo de 12 vozes simultâneas. A saída compartilhada recebeu um compressor. Nos cinco cenários finais medidos no volume máximo houve **zero amostras saturadas**; o maior pico foi **0,8886** no cenário de 12 vozes. Essa medição digital não substitui avaliação auditiva em fones, celulares ou caixas diferentes.

## Verificação final

| Verificação | Resultado |
| --- | --- |
| `npm test` | 135/135 aprovados, incluindo os 97 anteriores |
| `npm run test:game` | 204/204 em 25 arquivos |
| `npm run test:v31` | 26 capturas e 182 hashes aprovados; seis capturas Fighter em repouso/menu/pausa com zero pixels diferentes |
| `npm run test:fighter:polish` | 2.037 quadros completos de simulação iguais ao checkpoint: 1.185 treino, 463 CPU, 389 local |
| Mesmo teste de polish | 13 capturas adicionais, alterações reais de hit/block, 19 mídias decodificadas e áudio real executado no Chromium |
| Lifecycle/fallbacks no navegador | Mute, volume zero/parcial, dedupe, limite de vozes, pausa, blur, reinício, descarte, BFCache, arquivos corrompidos, ausência de AudioContext e efeitos reduzidos aprovados |
| `npm run test:fighter:audio` | 11 OGG reais e cinco misturas offline, incluindo 12 vozes no volume máximo; sem clipping |
| ESLint dos módulos/testes/ferramentas novos | Aprovado |
| `npm run build` | Interface e cinco etapas Vinext aprovadas; scanner de questões privadas aprovado |
| Revisão independente após correções | Sem problemas importantes restantes |

Os traces comparam o `H.match` inteiro, quadro a quadro, com entradas de teclado/UI reais. Não foi acrescentado estado cosmético à simulação nem alterado seu RNG. Os testes anteriores não tiveram referências regravadas para acomodar a mudança. As novas capturas ficam em `.sites-runtime/fighter-polish/`; os scripts reproduzem os cenários sem publicar dezenas de imagens duplicadas de cenários.

O teste de polish busca a referência pela cópia local ou por `git show bcade07:game/public/assets/fighters/index.html`. Também aceita `--reference caminho/para/index-original.html`, validando o hash. Em um clone raso sem esse commit, busque o histórico/tag ou forneça a cópia original. Requisitos: dependências da raiz e de `game/`, Chromium compatível.

## Testar e continuar

```powershell
npm run dev
# Minigames > Jogar Cronos Fighters
```

Para verificar separadamente, pare o servidor antes do build e execute os comandos da tabela. `test:fighter:polish` e `test:v31` iniciam seus próprios servidores de teste; os relatórios ficam ignorados em `.sites-runtime/`.

Ficam como limites: Chromium 156, computador/celular emulado e três modos com um par de personagens nas sequências detalhadas; não houve teste físico de gamepad, GPU de celular ou avaliação auditiva humana. O teste não percorre todas as 24×12 combinações. Supabase, estudo, dados remotos e modos online do Cronos não foram alterados nesta tarefa.

## Publicação

Código publicado na `main` em [`99ab3dc`](https://github.com/tiagodk/cronos/commit/99ab3dccdbf95c5c8e4bd08c3115c645f3499a8a), com push normal e a tag `checkpoint/fighter-before-polish-20261101`. Os 135 testes e o build foram repetidos na árvore final antes do envio; os 403 arquivos públicos conferem por SHA-256 com suas cópias geradas. Credenciais, downloads brutos, relatórios temporários, builds e dependências ficaram fora do Git.
