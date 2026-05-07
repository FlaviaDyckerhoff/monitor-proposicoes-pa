# Monitor de Proposições — ALEPA (Pará)

Monitor automático de proposições legislativas da Assembleia Legislativa do Estado do Pará.

## Como funciona

A ALEPA não disponibiliza API pública. O monitor usa uma abordagem de **varredura por ID sequencial**:

- Cada proposição tem uma URL pública com ID numérico sequencial:
  `https://alepa.pa.gov.br/Legislativo/DetalhesProposicao?IdProposicao=[ID]`
- O monitor tenta IDs a partir do último visto, parseia o HTML e detecta novas proposições
- IDs inexistentes retornam `500` — o monitor para após 10 consecutivos
- O estado (`estado.json`) salva o último ID processado

## Tipos monitorados

- 📋 Projeto de Lei Ordinária (PL)
- 📙 Projeto de Lei Complementar (PLC)
- 📜 Projeto de Decreto Legislativo (PDL)
- 🏛️ Projeto de Emenda Constitucional (PEC)
- 📌 Projeto de Resolução (PR)
- 📩 Projeto de Indicação / Indicação
- 📝 Requerimento
- 🗣️ Moção
- 📂 Processo

## Execução

4x por dia via GitHub Actions: 08h, 12h, 17h, 21h (horário de Belém/BRT).

## Secrets necessários

| Secret | Descrição |
|--------|-----------|
| `EMAIL_REMETENTE` | Gmail do remetente |
| `EMAIL_SENHA` | App Password Gmail (16 chars, sem espaços) |
| `EMAIL_DESTINO` | Email de destino dos alertas |

## Ponto de partida

- ID `15512` = PL nº 1/2026 (primeira proposição de 2026)
- `estado.json` inicial: `ultimo_id_visto: 15511`
- O primeiro run varre todos os IDs de 2026

## Portal

https://alepa.pa.gov.br/Home/Page/Proposicoes
