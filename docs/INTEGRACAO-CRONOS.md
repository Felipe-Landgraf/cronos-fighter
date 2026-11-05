# Cronos Fighters

**Atualização dos especiais e da locução:** vozes reais de Round/Fight/K.O., auras de preparação, ondas de liberação e impact frames no acerto. Veja [o relatório e os testes](docs/FIGHTER_ESPECIAIS_E_LOCUCAO.md). Golpes comuns e arte preservados; checkpoint anterior `189b873`.

**Acabamento audiovisual de 01/11/2026:** efeitos HD, auras, poeira, overlays breves e sons de cinco pacotes da comunidade, com os controles de volume/efeitos reduzidos existentes. Leia [FIGHTER_ACABAMENTO.md](docs/FIGHTER_ACABAMENTO.md) para fontes, licenças, checkpoint, peso adicional de aproximadamente 0,95 MB e testes. Créditos acessíveis no menu Controles do jogo.

O destaque em **Minigames** está liberado e abre `#minigames/cronos-fighters` após o login, como os demais minigames.

O jogo aprovado `CRONOS_V34_CAMINHADA_APROVADA.html` está em `game/public/assets/fighters/index.html`. As imagens e a fonte antes embutidas em base64 foram extraídas, sem modificar seus bytes, para `media/` nessa mesma pasta. O manifesto registra o SHA-256 do HTML original e os recursos extraídos.

O jogo só é carregado ao abrir sua tela. Mantém os modos contra a máquina, versus local (dois jogadores no mesmo dispositivo) e treino, além dos controles e das animações da versão enviada. A opção **Tela cheia** amplia o jogo; **Minigames** volta ao aplicativo e encerra a instância aberta. O Fighters usa seus próprios ajustes de som e preferências locais; a música do aplicativo é pausada nessa tela.

Não é necessária migração SQL ou mudança no `.dev.vars`. Ao compartilhar o código, inclua toda a pasta `game/public/assets/fighters`, inclusive `media/`. Execute o projeto normalmente pela raiz; o processo de build copia esses recursos para a versão publicada.
