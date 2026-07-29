# Guia da interface

`http://localhost:8095` — login com e-mail e senha (usuários da coleção `users`
do PocketBase).

## Visão geral

Números das últimas 24 h (requisições, taxa de cache, tokens ativos, clones),
as últimas chamadas recebidas e o estado do motor e da GPU.

A bolinha no rodapé da barra lateral mostra o estado em tempo real:
verde = modelo carregado, amarelo piscando = gerando agora, cinza = em espera,
vermelho = backend fora do ar.

## Clones de voz

Cada clone é um áudio de referência que o modelo usa para imitar o timbre.

**Para um bom resultado:**

- 3 a 10 segundos — mais que isso não melhora e deixa a geração mais lenta;
- só a voz: sem música, ruído de fundo ou outra pessoa falando;
- fala natural, em ritmo normal, na mesma língua que você vai gerar;
- preencha a **transcrição** com exatamente o que é falado no áudio — é o que mais
  melhora a semelhança;
- WAV ou FLAC dão resultado melhor que MP3 de bitrate baixo.

O **identificador** (slug) é o nome usado na API quando um token permite escolher
a voz no request (`{"voice": "maria-narradora"}`).

Trocar o áudio de um clone invalida automaticamente o cache dos áudios gerados
com ele.

> Clone apenas vozes que você tem autorização para usar.

## Tokens

Um token é a chave de acesso à API **e** um perfil de configuração. A ideia é que
quem consome mande só o texto:

| Campo | Efeito |
| --- | --- |
| Clone de voz | voz aplicada em toda requisição do token |
| Idioma | dica de idioma passada ao modelo |
| Bitrate do Opus | tamanho × qualidade do arquivo entregue |
| Permitir sobrescrever | deixa o cliente mandar `voice`, `language`, `temperature`… no corpo |
| Temperature / Top-p / Top-k / Repetition penalty | amostragem (avançado) |
| Limite por minuto | `0` = sem limite |
| Expira em | data após a qual o token deixa de funcionar |

### O valor em claro aparece uma vez

Ao criar, o token completo é mostrado num diálogo com botão de copiar e um exemplo
de `curl` pronto. **Copie na hora**: o servidor guarda apenas o `sha256`.

Uma cópia fica no `localStorage` **deste navegador** só para o Playground
funcionar sem você colar o token toda vez. Se você limpar os dados do navegador,
o token continua válido — você só perde o atalho, e passa a precisar colá-lo.

Perdeu o token? Crie outro e revogue o antigo.

### Desativar × revogar

- **Desativar** (clique em `ativo`/`inativo`): bloqueia na hora, dá para reverter.
- **Revogar** (ícone de lixeira): apaga o registro. Não tem volta.

Mudanças levam até 20 segundos para valer, por causa do cache de tokens do backend.

## Playground

Testa a API de verdade — mesma rota, mesmo token, mesmas regras de cache.

- escolha um token (ou cole um) e escreva o texto;
- **Ctrl+Enter** gera;
- o resultado mostra se veio do cache, a duração, o tamanho, o tempo de fila e o
  tempo de síntese;
- os blocos de código embaixo já vêm com o seu token e o corpo exato do request,
  prontos para colar em `curl`, Python ou JavaScript.

Se o token permitir overrides, aparece um painel para mandar voz, idioma e
temperatura junto do texto, como um cliente faria.

## Cache de áudio

Todo áudio gerado fica salvo em disco. Aqui você ouve, busca por texto, remove um
item ou limpa tudo.

Cada linha traz duração, tamanho, quantas vezes foi reaproveitada e o tempo que
levou para ser gerada na primeira vez.

Remover um item libera o espaço; a próxima requisição com aquele texto gera de novo.

## Requisições

Log de todas as chamadas: texto, token, voz, duração do áudio, tempo de resposta,
status HTTP e se veio do cache. Dá para filtrar por token, ver só erros e ligar a
atualização automática a cada 5 segundos.

## Sistema

Estado do motor e da GPU, com uso de VRAM em tempo real.

- **Carregar** — sobe o modelo para a GPU antecipadamente.
- **Descarregar** — libera a VRAM para outro programa. A próxima requisição
  recarrega sozinha (leva alguns segundos).

## Tema

O botão de sol/lua na barra lateral alterna claro e escuro; a preferência fica
salva no navegador.
