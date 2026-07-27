/**
 * Replay OFFLINE das fixtures HTTP do Redmine seedado (M5-06, issue #81).
 *
 * Reproduz — SEM rede e SEM docker — o fluxo real `getIssue → normalize →
 * bundle` (e o download de anexo) a partir das interações gravadas por
 * `scripts/record-fixtures.mjs` em `tests/fixtures/redmine-e2e/interactions.json`.
 *
 * Esta é a cobertura E2E-equivalente que roda na matriz mac/Windows do CI (#77),
 * onde o Docker (e, portanto, o E2E real do #80, só-Linux) não está disponível.
 * É DETERMINÍSTICO: o `fetch` global é substituído por um stub dirigido pelas
 * fixtures que LANÇA em qualquer requisição não gravada — se algo tentar tocar a
 * rede, o teste falha. Cross-SO: as fixtures não carregam paths de filesystem e o
 * download grava num diretório temporário do próprio SO.
 *
 * Também prova a AUSÊNCIA de segredos no arquivo versionado (nenhuma api_key,
 * Authorization, senha ou `?key=` real) — requisito crítico do #81.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createHttpClient,
  fetchIssueBundle,
  getIssue,
  normalizeIssue,
  type CoreEvent,
  type IssueBundleResult,
} from '../../src/index.js';
import { downloadAttachment, isSkipped } from '../../src/extract/index.js';

/** Caminho absoluto do arquivo de fixtures versionado. */
const FIXTURE_PATH = fileURLToPath(new URL('../fixtures/redmine-e2e/interactions.json', import.meta.url));

/** Uma interação HTTP gravada (uma requisição + a resposta esperada). */
interface RecordedInteraction {
  method: string;
  path: string;
  query: Record<string, string>;
  status: number;
  statusText: string;
  bodyKind: 'json' | 'base64';
  body: unknown;
}

/** Documento de fixtures completo (ver scripts/record-fixtures.mjs). */
interface FixtureDoc {
  schemaVersion: string;
  baseUrl: string;
  baseIssueIds: number[];
  attachment: { issueId: number; attachmentId: number; filename: string; downloadPath: string };
  interactions: RecordedInteraction[];
}

/** Texto bruto do arquivo (para a asserção de ausência de segredos). */
const RAW = readFileSync(FIXTURE_PATH, 'utf8');
const FIXTURE = JSON.parse(RAW) as FixtureDoc;

/** api_key sintética: o replay é offline, o valor nunca sai da máquina. */
const REPLAY_API_KEY = 'offline-replay-key';

/**
 * Constrói uma `Response` mínima no formato que o client HTTP consome
 * (`ok`/`status`/`statusText` + `json()` para JSON ou `body` para binário).
 */
function responseFor(interaction: RecordedInteraction): Response {
  const ok = interaction.status >= 200 && interaction.status < 300;
  if (interaction.bodyKind === 'base64') {
    const bytes = new Uint8Array(Buffer.from(String(interaction.body), 'base64'));
    return {
      ok,
      status: interaction.status,
      statusText: interaction.statusText,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    } as unknown as Response;
  }
  return {
    ok,
    status: interaction.status,
    statusText: interaction.statusText,
    json: async () => interaction.body,
  } as unknown as Response;
}

/** Todas as chaves de `query` da interação batem com a URL requisitada. */
function queryMatches(interaction: RecordedInteraction, url: URL): boolean {
  return Object.entries(interaction.query).every(([k, v]) => url.searchParams.get(k) === v);
}

/**
 * `fetch` stub dirigido pelas fixtures: casa por método + pathname + query. Uma
 * requisição sem correspondência LANÇA — garante o replay 100% offline.
 */
function makeReplayFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: unknown): Promise<Response> => {
    const url = input instanceof URL ? input : new URL(String(input));
    const match = FIXTURE.interactions.find(
      (i) => i.method === 'GET' && i.path === url.pathname && queryMatches(i, url),
    );
    if (match === undefined) {
      throw new Error(`replay offline: requisição não gravada — ${url.pathname}${url.search}`);
    }
    return responseFor(match);
  });
}

/** Drena o AsyncIterable e devolve o resultado final. */
async function drain(iterable: AsyncIterable<CoreEvent<IssueBundleResult>>): Promise<IssueBundleResult> {
  let result: IssueBundleResult | undefined;
  for await (const event of iterable) {
    if (event.kind === 'result') result = event.value;
  }
  if (result === undefined) throw new Error('o fluxo não emitiu um resultado');
  return result;
}

const baseOpts = { baseUrl: FIXTURE.baseUrl, apiKey: REPLAY_API_KEY, toolVersion: '0.1.0' } as const;

/** Strings de fixture que o bundle Markdown DEVE conter, por issue base 1..3. */
const NEEDLES: Record<number, string[]> = {
  [FIXTURE.baseIssueIds[0] ?? 0]: [
    'RC Fixture: issue base 1',
    'Issue base 1 gerada pelo seed',
    'Comentário de fixture na issue base 1',
    'Alta',
    'fixture-note.txt',
  ],
  [FIXTURE.baseIssueIds[1] ?? 0]: [
    'RC Fixture: issue base 2',
    'Issue base 2 gerada pelo seed',
    'Comentário de fixture na issue base 2',
    'Média',
  ],
  [FIXTURE.baseIssueIds[2] ?? 0]: [
    'RC Fixture: issue base 3',
    'Issue base 3 gerada pelo seed',
    'Comentário de fixture na issue base 3',
    'Baixa',
  ],
};

describe('replay offline das fixtures do Redmine seedado (M5-06 #81)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', makeReplayFetch());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('grava 4 interações e nenhuma requisição tocou a rede (stub dirigido por fixtures)', () => {
    expect(FIXTURE.schemaVersion).toBe('1.0');
    expect(FIXTURE.interactions).toHaveLength(4);
    expect(FIXTURE.baseIssueIds).toHaveLength(3);
  });

  // Caso esperado: cada issue empacota Markdown determinístico com as strings do seed.
  it.each(FIXTURE.baseIssueIds)('empacota a issue base %s (Markdown) com as strings do seed', async (id) => {
    const result = await drain(fetchIssueBundle({ ...baseOpts, issueId: id, format: 'md' }));

    expect(result.format).toBe('md');
    expect(result.issueId).toBe(id);
    for (const needle of NEEDLES[id] ?? []) {
      expect(result.content).toContain(needle);
    }
    expect(result.content).toMatchSnapshot();
  });

  // Determinismo: JSON canônico byte-idêntico entre execuções repetidas.
  it('JSON canônico é determinístico entre execuções (offline)', async () => {
    const id = FIXTURE.baseIssueIds[0] ?? 0;
    const first = await drain(fetchIssueBundle({ ...baseOpts, issueId: id, format: 'json' }));
    const second = await drain(fetchIssueBundle({ ...baseOpts, issueId: id, format: 'json' }));

    expect(first.content).toBe(second.content);
    const parsed = JSON.parse(first.content) as { schema_version: string; issue: { id: number } };
    expect(parsed.issue.id).toBe(id);
    expect(first.content).toMatchSnapshot();
  });

  // Download de anexo replayado offline: os bytes gravados são reconstruídos em disco.
  it('reproduz o download do anexo de texto offline e grava os bytes originais', async () => {
    const http = createHttpClient({ baseUrl: FIXTURE.baseUrl, apiKey: REPLAY_API_KEY });
    const issue = normalizeIssue(await getIssue(http, FIXTURE.attachment.issueId));
    const attachment = issue.attachments.find((a) => a.filename === FIXTURE.attachment.filename);
    expect(attachment).toBeDefined();
    if (attachment === undefined) return;

    const cacheDir = mkdtempSync(join(tmpdir(), 'rc-replay-'));
    try {
      const result = await downloadAttachment(http, attachment, {
        cacheDir,
        instanceUrl: FIXTURE.baseUrl,
      });
      expect(isSkipped(result)).toBe(false);
      if (isSkipped(result)) return;

      const content = await readFile(result, 'utf8');
      expect(content).toBe('Anexo de fixture gerado pelo seed (rc-fixtures).\n');
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  // Falha: uma issue não gravada não encontra fixture e o replay recusa a rede.
  it('recusa (offline) uma issue sem fixture gravada — prova o isolamento de rede', async () => {
    await expect(drain(fetchIssueBundle({ ...baseOpts, issueId: 99999, format: 'md' }))).rejects.toThrow(
      /replay offline: requisição não gravada/,
    );
  });
});

describe('fixtures versionadas: ausência de segredos (M5-06 #81)', () => {
  // Escopo do scan: os DADOS gravados (requisições + respostas). O `note`/`meta`
  // humano é descritivo e legitimamente cita "api_key"/"Authorization" ao
  // documentar a redação — não é um segredo e fica fora do grep.
  const interactionsRaw = JSON.stringify(FIXTURE.interactions);

  // Requisito crítico: nenhum segredo real pode ir para o repositório.
  it('não contém api_key, Authorization, senha nem `?key=` real', () => {
    expect(interactionsRaw).not.toMatch(/x-redmine-api-key/i);
    expect(interactionsRaw).not.toMatch(/authorization/i);
    expect(interactionsRaw).not.toMatch(/\bbasic\s+[a-z0-9+/=]{8,}/i);
    expect(interactionsRaw).not.toMatch(/[?&]key=/i);
    expect(interactionsRaw).not.toMatch(/"(api_?key|token|password|passwd|secret)"\s*:\s*"(?!\[REDACTED\])/i);
    // O host local do stack de gravação não pode vazar: foi reescrito p/ o placeholder.
    expect(RAW).not.toContain('localhost:3080');
    expect(FIXTURE.baseUrl).toBe('https://redmine.example');
  });

  // Campos sensíveis, se existirem, aparecem apenas REDIGIDOS.
  it('qualquer campo sensível está redigido com [REDACTED]', () => {
    const apiKeyValues = [...interactionsRaw.matchAll(/"api_key"\s*:\s*("[^"]*"|null)/gi)].map((m) => m[1]);
    for (const value of apiKeyValues) {
      expect(value).toBe('"[REDACTED]"');
    }
  });
});
