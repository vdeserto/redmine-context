#!/usr/bin/env node
/**
 * Entry point do CLI `redmine-context` (M1-11).
 *
 * Superfície fina (ADR-005): faz parse manual de `argv` — sem framework de CLI,
 * são apenas dois comandos —, despacha para os handlers em `./commands.js` e
 * devolve o exit code. Progresso vai para stderr; o bundle vai para stdout.
 *
 * O core é consumido apenas pela superfície pública (`../../index.js`); nenhum
 * módulo interno é importado aqui (regra eslint `no-restricted-imports`).
 */

import { pathToFileURL } from 'node:url';

import { runIssue, runLogin } from './commands.js';
import { prompt, promptPassword } from './prompts.js';
import type { ParsedArgs, RunDeps } from './types.js';

/** Flags que consomem o próximo token como valor (as demais são booleanas). */
const VALUE_FLAGS = new Set(['out', 'url', 'api-key']);

/** Texto do `--help` — limpo, sem referências a ferramentas de IA. */
const HELP = `redmine-context — contexto completo de issues do Redmine para LLMs

Uso:
  redmine-context issue <id> [opções]
  redmine-context login [opções]

Comando issue:
  Busca a issue, normaliza e imprime o bundle em stdout (Markdown por padrão).
  O progresso da operação é enviado para stderr.

  --json            Emite o bundle JSON canônico em vez de Markdown.
  --out <dir>       Grava o bundle em <dir>/<id>.md|.json em vez de stdout.
  --url <url>       URL da instância Redmine (ou defina REDMINE_URL).
  --insecure        Permite http:// sem TLS (não recomendado).

Comando login:
  Autentica por usuário/senha e salva a api_key para a instância.
  Em contas com 2FA, cole a api_key quando solicitado (ou use --api-key).

  --url <url>       URL da instância Redmine.
  --api-key <key>   Salva a api_key diretamente, sem senha.
  --insecure        Permite http:// sem TLS (não recomendado).

Credenciais:
  A api_key é resolvida na ordem: arquivo de credenciais -> REDMINE_API_KEY.
  Sem credencial, rode: redmine-context login

Exit codes:
  0  sucesso
  1  erro genérico ou uso inválido
  2  falha de autenticação ou credencial ausente
  3  erro de rede ou HTTP
  4  issue inexistente
`;

/**
 * Parse manual de `argv` (após o nome do comando).
 *
 * Reconhece `--flag valor` para as flags de {@link VALUE_FLAGS} e `--flag`/`-h`
 * como booleanas; o restante são posicionais.
 *
 * @param argv - Argumentos após `node main.js`.
 * @returns Posicionais e flags. Ver {@link ParsedArgs}.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    if (token === '-h') {
      flags.set('help', true);
      continue;
    }
    if (token.startsWith('--')) {
      const name = token.slice(2);
      if (VALUE_FLAGS.has(name)) {
        const value = argv[i + 1];
        flags.set(name, value ?? '');
        i++;
      } else {
        flags.set(name, true);
      }
      continue;
    }
    positionals.push(token);
  }

  return { positionals, flags };
}

/** Constrói as dependências default apontando para o processo real. */
function defaultDeps(): RunDeps {
  return {
    stdout: (text) => void process.stdout.write(text),
    stderr: (text) => void process.stderr.write(text),
    env: process.env,
    prompt,
    promptPassword,
  };
}

/**
 * Ponto de entrada testável: faz parse, despacha o comando e devolve o exit code.
 *
 * @param argv - Argumentos após `node main.js` (ex.: `process.argv.slice(2)`).
 * @param overrides - Dependências injetáveis (I/O, prompts, env) para testes.
 * @returns O exit code do processo (0 = sucesso).
 * @example
 * const code = await run(['issue', '42', '--url', 'https://redmine.example']);
 */
export async function run(argv: string[], overrides: Partial<RunDeps> = {}): Promise<number> {
  const deps: RunDeps = { ...defaultDeps(), ...overrides };
  const parsed = parseArgs(argv);
  const command = parsed.positionals[0];

  if (parsed.flags.get('help') === true || command === 'help') {
    deps.stdout(HELP);
    return 0;
  }
  if (command === undefined) {
    deps.stderr(HELP);
    return 1;
  }
  if (command === 'issue') {
    return runIssue(parsed, deps);
  }
  if (command === 'login') {
    return runLogin(parsed, deps);
  }

  deps.stderr(`Comando desconhecido: ${command}\n\n${HELP}`);
  return 1;
}

/* c8 ignore start -- wire de execução; coberto pelo teste E2E real (#20). */
const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
/* c8 ignore stop */
