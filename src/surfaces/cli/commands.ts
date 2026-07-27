/**
 * Handlers dos comandos do CLI (M1-11): `issue` e `login`.
 *
 * Consomem EXCLUSIVAMENTE a superfície pública do core (`../../index.js`,
 * fronteira do ADR-005) — a orquestração `fetchIssueBundle`, o `loginWithPassword`
 * e a cascata de credenciais. Cada handler devolve o exit code do processo; o
 * mapeamento status→código vive em {@link exitCodeForError} e é documentado no
 * `--help`.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import * as core from '../../index.js';
import type { BundleFormat } from '../../index.js';
import type { ParsedArgs, RunDeps } from './types.js';

/** Exit codes do CLI (documentados no `--help`). */
export const EXIT = {
  /** Erro genérico ou uso inválido. */
  GENERIC: 1,
  /** Falha de autenticação ou credencial ausente. */
  AUTH: 2,
  /** Erro de rede ou HTTP. */
  NETWORK: 3,
  /** Issue inexistente. */
  NOT_FOUND: 4,
} as const;

/** Extrai uma mensagem legível de um erro desconhecido. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Mapeia um erro para o exit code do CLI.
 *
 * Ordem importa: os erros específicos (404, 401) estendem `RedmineHttpError` e
 * precisam ser testados antes do genérico HTTP. Erros de rede (sem status) são
 * detectados pela mensagem do client e também caem em {@link EXIT.NETWORK}.
 *
 * @param error - Erro capturado durante a operação.
 * @returns O exit code correspondente.
 */
export function exitCodeForError(error: unknown): number {
  if (error instanceof core.RedmineNotFoundError) return EXIT.NOT_FOUND;
  if (error instanceof core.RedmineAuthError) return EXIT.AUTH;
  if (error instanceof core.RedmineLoginError) return EXIT.AUTH;
  if (error instanceof core.RedmineHttpError) return EXIT.NETWORK;
  if (error instanceof Error && /falha de rede|network|fetch failed|econn|enotfound|etimedout/i.test(error.message)) {
    return EXIT.NETWORK;
  }
  return EXIT.GENERIC;
}

/** Lê uma flag com valor string, ou `undefined` se ausente/booleana. */
function stringFlag(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

/**
 * Comando `issue <id>`: resolve credencial pela cascata, empacota e emite o
 * bundle (stdout ou `--out <dir>`), com progresso em stderr.
 *
 * @param parsed - Argumentos parseados (posicional `<id>` + flags).
 * @param deps - Dependências injetáveis (I/O, env).
 * @returns Exit code do processo.
 */
export async function runIssue(parsed: ParsedArgs, deps: RunDeps): Promise<number> {
  const idRaw = parsed.positionals[1];
  const issueId = Number(idRaw);
  if (idRaw === undefined || !Number.isInteger(issueId) || issueId <= 0) {
    deps.stderr(`Id de issue inválido: ${idRaw ?? '(ausente)'}. Uso: redmine-context issue <id>\n`);
    return EXIT.GENERIC;
  }

  // Instância: --url → REDMINE_URL → URL persistida no login (#187).
  const persistedUrl = deps.settings ? await deps.settings.getInstanceUrl() : undefined;
  const resolved = core.resolveInstanceUrl({
    flagUrl: stringFlag(parsed, 'url'),
    envUrl: deps.env.REDMINE_URL,
    persistedUrl,
  });
  if (resolved === undefined) {
    deps.stderr(
      'Instância não configurada. Use --url <url>, defina REDMINE_URL, ou rode `redmine-context login`.\n',
    );
    return EXIT.GENERIC;
  }
  const baseUrl = resolved.url;
  const insecure = parsed.flags.get('insecure') === true;

  let apiKey: string | undefined;
  try {
    apiKey = await core.resolveApiKey(baseUrl, {
      env: deps.env,
      logger: { warn: (message) => deps.stderr(`${message}\n`) },
    });
  } catch (error) {
    deps.stderr(`${messageOf(error)}\n`);
    return exitCodeForError(error);
  }
  if (apiKey === undefined) {
    deps.stderr(`Nenhuma credencial encontrada para ${baseUrl}.\nRode: redmine-context login\n`);
    return EXIT.AUTH;
  }

  const format: BundleFormat = parsed.flags.get('json') === true ? 'json' : 'md';
  const outDir = stringFlag(parsed, 'out');
  // --extract liga a extração de texto dos anexos (OCR) no bundle (M3-13).
  const extractAttachments = parsed.flags.get('extract') === true;

  try {
    let content: string | undefined;
    for await (const event of core.fetchIssueBundle({
      baseUrl,
      apiKey,
      issueId,
      format,
      toolVersion: core.TOOL_VERSION,
      insecure,
      extractAttachments,
    })) {
      if (event.kind === 'progress') {
        deps.stderr(`... ${event.message}\n`);
      } else {
        content = event.value.content;
      }
    }
    if (content === undefined) {
      deps.stderr('Operação não produziu um bundle.\n');
      return EXIT.GENERIC;
    }

    if (outDir !== undefined) {
      const ext = format === 'json' ? 'json' : 'md';
      const filePath = join(outDir, `${issueId}.${ext}`);
      await mkdir(outDir, { recursive: true });
      await writeFile(filePath, content, 'utf8');
      deps.stderr(`Bundle gravado em ${filePath}\n`);
    } else {
      deps.stdout(content);
    }
    return 0;
  } catch (error) {
    deps.stderr(`${messageOf(error)}\n`);
    return exitCodeForError(error);
  }
}

/**
 * Comando `doctor`: diagnostica os binários de mídia (hoje o `tesseract`) e
 * imprime um relatório em TEXTO PURO no stdout. Degrada naturalmente em
 * `NO_COLOR`/não-TTY (não emite cor/ANSI). Exit 0 se todos presentes, 1 se
 * faltar algum — o exit code deixa o resultado programável em scripts.
 *
 * @param _parsed - Argumentos parseados (o comando não usa flags hoje).
 * @param deps - Dependências injetáveis (I/O).
 * @returns Exit code do processo (0 = tudo ok, 1 = binário faltando).
 */
export async function runDoctor(_parsed: ParsedArgs, deps: RunDeps): Promise<number> {
  const diagnoses = await core.diagnoseBinaries();
  deps.stdout('Binários de mídia:\n');

  let allPresent = true;
  for (const binary of diagnoses) {
    if (binary.found) {
      const version = binary.version !== undefined ? ` v${binary.version}` : '';
      const location = binary.path !== undefined ? ` (${binary.path})` : '';
      deps.stdout(`  [ok] ${binary.name}${version}${location}\n`);
    } else {
      allPresent = false;
      deps.stdout(`  [faltando] ${binary.name} — instale com: ${binary.installHint}\n`);
    }
  }

  return allPresent ? 0 : EXIT.GENERIC;
}

/**
 * Descobre a api_key interativamente: login por senha e, no fallback de 2FA
 * (ou senha inválida), orienta colar a api_key.
 *
 * @param baseUrl - URL da instância Redmine.
 * @param insecure - Permite `http://` sem TLS.
 * @param deps - Dependências injetáveis (prompts, I/O).
 * @returns A api_key resolvida.
 * @throws {RedmineLoginError | RedmineAuthError | Error} Se o login falhar sem
 *   fallback utilizável.
 */
async function resolveKeyInteractively(baseUrl: string, insecure: boolean, deps: RunDeps): Promise<string> {
  const username = (await deps.prompt('Usuário: ')).trim();
  const password = await deps.promptPassword('Senha: ');
  try {
    const result = await core.loginWithPassword({ baseUrl, username, password, insecure });
    return result.apiKey;
  } catch (error) {
    if (error instanceof core.RedmineAuthError) {
      deps.stderr(`${messageOf(error)}\n`);
      deps.stderr('Cole sua api_key para concluir o login (conta com 2FA ou senha inválida):\n');
      const pasted = (await deps.promptPassword('api_key: ')).trim();
      if (pasted.length === 0) {
        throw error;
      }
      return pasted;
    }
    throw error;
  }
}

/**
 * Comando `login`: autentica (senha ou `--api-key`) e salva a api_key na
 * cascata para a instância informada.
 *
 * @param parsed - Argumentos parseados (flags `--url`, `--api-key`, `--insecure`).
 * @param deps - Dependências injetáveis (prompts, I/O, env).
 * @returns Exit code do processo.
 */
export async function runLogin(parsed: ParsedArgs, deps: RunDeps): Promise<number> {
  const insecure = parsed.flags.get('insecure') === true;

  const persistedUrl = deps.settings ? await deps.settings.getInstanceUrl() : undefined;
  let baseUrl = stringFlag(parsed, 'url') ?? deps.env.REDMINE_URL ?? persistedUrl;
  if (baseUrl === undefined || baseUrl.length === 0) {
    baseUrl = (await deps.prompt('URL do Redmine: ')).trim();
  }
  if (baseUrl.length === 0) {
    deps.stderr('URL do Redmine é obrigatória.\n');
    return EXIT.GENERIC;
  }

  const directKey = stringFlag(parsed, 'api-key');
  try {
    const apiKey =
      directKey !== undefined && directKey.length > 0
        ? directKey
        : await resolveKeyInteractively(baseUrl, insecure, deps);
    if (apiKey.length === 0) {
      deps.stderr('api_key vazia; login abortado.\n');
      return EXIT.AUTH;
    }
    // Persiste preferindo o keychain do SO (fallback arquivo se indisponível).
    await core
      .createCredentialCascade({
        env: deps.env,
        logger: { warn: (message) => deps.stderr(`${message}\n`) },
      })
      .set(baseUrl, apiKey);
    // Persiste a instância (#187) para que TUI/CLI/MCP não dependam de REDMINE_URL.
    // Falha ao salvar a instância NÃO invalida o login (a credencial já foi salva).
    try {
      await deps.settings?.setInstanceUrl(baseUrl);
    } catch (error) {
      deps.stderr(`aviso: não foi possível salvar a instância padrão: ${messageOf(error)}\n`);
    }
    deps.stderr(`Credencial salva para ${baseUrl}.\n`);
    return 0;
  } catch (error) {
    deps.stderr(`${messageOf(error)}\n`);
    return exitCodeForError(error);
  }
}
