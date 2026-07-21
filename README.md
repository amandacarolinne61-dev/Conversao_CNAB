# Conciliação CNAB — Remessa × Retorno

Sistema para guardar as remessas enviadas ao banco/portador, cruzar com os
arquivos de retorno (por Nosso Número) e gerar a baixa pronta pra importar
no G3.

## 1. Criar o banco no Supabase

1. Crie uma conta em https://supabase.com e um novo projeto.
2. No painel do projeto, abra **SQL Editor** e rode o conteúdo do arquivo
   `schema.sql` (cria as tabelas `remessas`, `titulos`, `retornos`,
   `movimentos_retorno` e `ocorrencias_ref`).
3. Em **Project Settings → API**, copie a **Project URL** e a
   **service_role key** (não é a `anon` key — precisa ser a service role,
   porque as gravações rodam do servidor).

## 2. Configurar as variáveis de ambiente

Copie `.env.local.example` para `.env.local` e preencha:

```
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua-service-role-key-aqui
```

No Vercel, adicione as mesmas duas variáveis em
**Project Settings → Environment Variables**.

## 3. Rodar localmente (opcional)

```
npm install
npm run dev
```

Abre em http://localhost:3000

## 4. Deploy

Suba esse repositório pro GitHub e conecte no Vercel (igual ao Validador de
Baixas) — o Vercel detecta automaticamente que é um projeto Next.js.

## Como usar

1. **Enviar remessa** — sobe o arquivo `.TXT`/`.REM` gerado antes do envio ao
   banco. Grava os títulos no banco com status `aguardando_retorno`.
2. **Enviar retorno** — sobe o arquivo `.RET` recebido da factoring. O
   sistema casa cada movimento pelo **Nosso Número**, atualiza o status do
   título e registra o histórico em `movimentos_retorno`.
3. **Exportar baixas** — baixa um CSV só com os títulos que tiveram
   ocorrência de liquidação (código `06`), pronto pra importar no G3.

## Sobre o parser do retorno

Alguns arquivos de retorno (ex: Bancorp) não têm largura 100% fixa: um campo
no meio da linha varia de tamanho, empurrando o resto por 1 caractere. O
parser (`lib/cnabRetorno.js`) contorna isso lendo os campos estáveis do
início da linha (CNPJ, Nosso Número, código de ocorrência) e os campos
estáveis do fim da linha (data, valor, nome do sacado) — nenhum dos dois
lados é afetado pela variação, só o meio.

## Ocorrências mapeadas

| Código | Descrição | Gera baixa automática? |
|---|---|---|
| 02 | Entrada Confirmada | Não |
| 03 | Entrada Rejeitada | Não |
| 06 | Liquidação Normal | **Sim** |
| 09 | Baixa Simples | Não |
| 15 | Baixa Rejeitada | Não |

Pra adicionar um novo código, basta incluir uma linha na tabela
`ocorrencias_ref` no Supabase — não precisa mexer no código.
