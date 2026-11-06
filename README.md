# Cronos Fighter

**Jogo de luta para navegador · Desenvolvimento integral por Felipe Landgraf**

Personagens de diferentes períodos da História se encontram em uma arena de combate. O jogo faz parte da plataforma educacional [Cronos](https://joguecronos.com.br) e também pode ser aberto diretamente pelo link abaixo.

**[Jogar no navegador](https://felipe-landgraf.github.io/cronos-fighter/)** · [Jogar no Cronos](https://joguecronos.com.br/#minigames/cronos-fighters) · [Baixar o projeto](https://github.com/Felipe-Landgraf/cronos-fighter/archive/refs/heads/main.zip)

![Cronos Fighter: combate na arena de Alexandria](docs/previa.png)

## Minha atuação

Sou **[Felipe Landgraf](https://github.com/Felipe-Landgraf)**, estudante de Desenvolvimento de Sistemas no **COTIL–Unicamp** e responsável pelo desenvolvimento completo do Cronos Fighter: lógica de combate, interface, animações e integração dos recursos audiovisuais.

O desenvolvimento do jogo integra o projeto Cronos. Os recursos de terceiros utilizados mantêm suas atribuições e licenças.

## Funcionalidades

- 24 personagens históricos distribuídos por seis períodos.
- Partidas contra o computador e modo local para dois jogadores.
- Socos, chutes, rasteiras, defesa e ataques especiais.
- Animações de movimentação e combate.
- Efeitos visuais, áudio e locução.
- Suporte a teclado, toque e gamepad.

## Tecnologias

| Tecnologia | Aplicação |
| --- | --- |
| JavaScript | Lógica de combate, estados da partida e interação |
| HTML e CSS | Interface, menus e controles |
| Canvas API | Renderização da arena, personagens e efeitos |
| Web Audio API | Áudio e efeitos sonoros |
| Gamepad API | Suporte a controles |

## Como jogar

Abra **[a demonstração](https://felipe-landgraf.github.io/cronos-fighter/)**, escolha o modo de jogo e os personagens. Os controles podem ser consultados na própria interface. Não é necessário instalar nada para jogar no navegador.

## Executar localmente

Requer **Node.js 18 ou superior**, sem dependências adicionais.

```sh
npm start
```

Depois, abra **http://127.0.0.1:4173**. O servidor local permite carregar os módulos e os recursos do jogo.

## Estrutura

```text
index.html             Jogo e interface
media/                 Imagens, animações e fonte
polish/                Efeitos, áudio e créditos
polish/licenses/       Licenças dos recursos de terceiros
tests/                 Verificações automatizadas
tools/                 Servidor local
docs/                  Prévia e documentação técnica
VERSION.json           Identificação da versão
```

## Versão e verificação

Distribuição **V34 — Caminhada aprovada**, com as melhorias audiovisuais integradas ao [repositório Cronos da equipe](https://github.com/tiagodk/cronos). A origem e a identificação completa estão em [VERSION.json](VERSION.json).

Para executar as verificações:

```sh
npm test
```

A versão publicada passou por **61 testes automatizados** de recursos, licenças, áudio, pausa e efeitos visuais. Os testes não substituem uma partida em dispositivos reais.

## Créditos e licenças

Consulte [os créditos completos](polish/credits.html), o [manifesto dos recursos](polish/manifest.json), as [licenças originais](polish/licenses/) e a [licença da fonte](FONT-LICENSE.txt).

A autoria do desenvolvimento do jogo não substitui a autoria dos recursos de terceiros. As licenças específicas desses recursos permanecem aplicáveis.

---

Projeto de **[Felipe Landgraf](https://github.com/Felipe-Landgraf)**.
