# Fighter: especiais e locução · 01/11/2026

## O que mudou

- Locução arcade real em inglês: rounds 1–3, **Fight**, **K.O.**, fim do tempo e empate. A interface continua em português.
- Preparação dos especiais com contraste no cenário, aura e raios na cor do personagem; liberação com anel expansivo.
- Contatos confirmados de especiais recebem explosão maior, fragmentos radiais e um impact frame escuro breve, atrás dos personagens. O quadro de contraste dura até quatro ticks visuais, com queda de intensidade; não acrescenta pausa à luta.
- Bloqueios mantêm resposta mais contida e especiais que erram não geram explosões de contato. Os efeitos dos golpes comuns foram preservados.
- A liberação sonora dos especiais ganhou aproximadamente 3,2 dB no sample, preservando o ganho mestre e os sons comuns.

Personagens, cenários, HUD, menus, controles, dano, hitboxes, tempos dos golpes, hitstop e RNG foram preservados. Os efeitos continuam no mesmo Canvas/RAF; o áudio usa o AudioContext da partida. O relógio cosmético é separado de `H.match`, avança no hitstop/encerramento e para na pausa/perda de foco.

## Gravações e licenças

| Origem | Uso | Licença |
| --- | --- | --- |
| [DRAGON — VoiceBosch](https://voicebosch.itch.io/dragon-announcer-audio-pack) | Rounds 1–3, Fight e K.O. | CC BY-SA 4.0 |
| [Voiceover Pack Fighter — Kenney](https://kenney.nl/assets/voiceover-pack-fighter) | Tempo e empate | CC0 |

As cinco gravações do VoiceBosch tiveram somente silêncio externo aparado, conversão mono e compressão Vorbis. As derivações conservam CC BY-SA 4.0; origem, hash do WAV original, hash do OGG, duração e conversão estão no manifesto. Essa atribuição refere-se às gravações selecionadas. Os dois arquivos Kenney conservam os bytes originais.

Os avisos acompanham `game/public/assets/fighters/polish/licenses/` e **Controles → Créditos e licenças**. Os efeitos visuais reutilizam os oito PNG já integrados dos cinco pacotes anteriores. Downloads brutos, encoder, capturas e relatórios temporários ficam ignorados em `.sites-runtime/`.

A locução usa sua própria prioridade, pitch natural e duração completa. Doze efeitos podem tocar junto; efeitos comuns não descartam a fala. Round/Fight são sequenciais; resultados substituem anúncios antigos. Pausa, mute, saída e reinício cancelam o áudio. O primeiro round tenta novamente quando o carregamento termina, somente se ainda estiver nos primeiros 700 ms do mesmo countdown ativo: não há reprodução atrasada de uma fala antiga se a rede demorar.

## Regressão e retomada

Checkpoint anterior: `189b873`, tag **`checkpoint/fighter-before-specials-20261101`**. Não substituir as referências visuais existentes para acomodar diferenças. O teste de polish compara a simulação com `bcade07` e os golpes comuns com `189b873`, validando ambos os hashes. Em clone raso, buscar esse histórico antes dos testes.

Uma revisão independente identificou a faixa de contraste incompleta no celular. A camada passou a cobrir a extensão real do canvas por meio da transformação inversa do viewport. O arco de liberação também foi corrigido para acompanhar ataques voltados para a esquerda. Ambos têm testes específicos.

### Verificações

| Verificação | Resultado |
| --- | --- |
| `npm test` | 158/158 aprovados |
| `npm run test:game` | 204/204 aprovados em 25 arquivos |
| `npm run test:v31` | 26 capturas, oito grupos de comportamento e 182 hashes aprovados; as seis capturas Fighter de menu/repouso/pausa ficaram com zero pixels diferentes |
| `npm run test:fighter:polish` | 2.037 snapshots completos de simulação idênticos: treino 1.185, CPU 463, local 389; 50 capturas e oito grupos de verificação aprovados |
| `npm run test:fighter:audio` | 18 OGG reais decodificados, 17 misturas sem clipping, incluindo locução completa com 12 efeitos no volume máximo; maior pico 0,77781 |
| Probes de especiais/locução | Capturas reais de preparação/liberação/contato/hitstop em desktop e celular, redução de efeitos, bloqueio e esquiva; primeira fala, reinício, K.O. e Round 2/Fight completos no navegador |
| ESLint dos módulos/testes/ferramentas Fighter | Aprovado |
| `npm run build` | Interface e cinco etapas Vinext aprovadas; os 412 arquivos públicos conferem por SHA-256 com as cópias geradas |
| Revisão independente | Correção do contraste em retrato verificada; sem achados restantes |

A comparação completa preservou os efeitos comuns aprovados: nenhum pixel diferente acima de dois níveis RGB por canal. A tolerância de 2/255 exclui uma variação observada de um nível de vermelho em um único pixel suavizado do piso; não afrouxa os traces de simulação nem os hashes. As referências antigas não foram regravadas. Relatórios e capturas ficam em `.sites-runtime/fighter-polish/`.

## Peso

As sete gravações novas somam **109.063 bytes**. As mídias de acabamento agora totalizam **1.024.596 bytes** (oito PNG e 18 OGG). Incluindo módulos, integração, manifesto e avisos, esta atualização acrescenta aproximadamente **150 KB** aos arquivos públicos, sem compressão. O frontend principal mantém os mesmos arquivos JS/CSS; os 182 assets originais permanecem intactos.

### Executar

```powershell
npm run dev
# Cronos: Minigames > Jogar Cronos Fighters
```

Na raiz, as verificações são `npm test`, `npm run test:game`, `npm run test:v31`, `npm run test:fighter:polish`, `npm run test:fighter:audio` e `npm run build`. Pare o servidor de desenvolvimento da raiz antes do build. Os verificadores iniciam seus próprios servidores de teste.

Limites: testes em Chromium, desktop e celular emulado; medição digital de áudio e reprodução observada pelo navegador não equivalem a avaliação auditiva humana em dispositivos físicos. Não há teste de todas as combinações de personagens e cenários. Esta entrega não altera Supabase ou multiplayer.

## Publicação

Implementação publicada na `main` em `cfcd47f`, com push normal e a tag `checkpoint/fighter-before-specials-20261101` apontando para `189b873`. Nenhum download bruto, build, dependência, relatório temporário ou credencial foi incluído. O `.gitignore` existente já cobre esses arquivos. A implementação está concluída; futuros ajustes de timbre/intensidade partem desta versão e da avaliação da equipe em jogo.
