# TNT Esportes — guia visual

Portal esportivo institucional da Secretaria Municipal de Esportes de Tonantins/AM. Este arquivo existe para o visual
não voltar a se misturar com o do SIGEP (ponto de escola/RH).

## Identidade
- Cores da bandeira de Tonantins: azul `--g9 #0d2f73` / `--g7 #1d55b8`, verde `--gold #2db35d`, fundo `--bg #eef2f8`.
- Marca: hexágono (as lajotas da praça) verde com "TNT" em azul (`img/marca.svg`, `icone.svg`).
- Tipografia: Barlow Condensed em caixa alta nos títulos (energia de esporte); Barlow no texto. Mínimo 12 px.
- Fotos: só lugares de Tonantins (rio, praça, ginásio, orla). Fotos de jogo/torcida só com autorização de imagem.

## Fundos (usar no máximo um efeito por região; telas de trabalho ficam planas)
Ondas do rio e grão (login), meio-tom (canto do herói), linhas de contorno (faixas e placar), vidro canelado (próximo jogo
sobre foto), grade de pontos (fundo da página, bem leve), papel (documentos impressos).

## Componentes
- Cartão de jogo (`.match.jogo`): dados em cima, times e placar no meio, UMA ação principal; resto em "Mais". O próximo jogo é `.destaque`.
- Navegação da Secretaria: 5 grupos (Painel, Campeonatos, Jogos, Equipes, Mais) com sub-botões; barra inferior no celular.
- Chips de filtro (`.chips`), selos (`.pill`), tabelas (`.st` dentro de `.scroll`).

## Regras
- Tokens em `:root` (`--sp-*`, `--r-*`, `--sombra-*`, `--campo`); borda de campo com contraste 3:1.
- Animar só transform, opacidade, cor e sombra; respeitar `prefers-reduced-motion`. Nunca `transition: all`.
- Ação destrutiva pede confirmação. Foco visível sempre (azul no claro, branco no escuro).
- Todo CSS/JS novo: subir a versão do service worker (`sw.js`) e rodar `node checar.js`.
- `js/etapas.js` é idêntico ao do SIGEP: não alterar sem avisar.
