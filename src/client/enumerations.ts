/**
 * Enumerações da instância (status, trackers, prioridades) — `id → nome`.
 *
 * O histórico de uma issue guarda apenas ids (`status_id: 12 → 7`), e a issue
 * carrega o nome SÓ do estado atual. Sem estas listas, metade de cada alteração
 * fica ilegível: "não sei o que é status 12".
 *
 * São coleções pequenas, estáveis e legíveis por qualquer usuário autenticado
 * (não exigem admin, ao contrário de `/users.json`). O resultado é memoizado por
 * instância no processo — a TUI e o servidor MCP são processos longos e não
 * devem repetir estes GETs a cada issue.
 *
 * DEGRADAÇÃO (ADR-005): cada endpoint falha de forma independente e silenciosa.
 * Uma instância que restrinja `/trackers.json` continua resolvendo status e
 * prioridade; sem nenhum deles, o chamador volta a exibir `#id` — nunca um erro.
 */

import type { HttpClient } from './http.js';

/** Mapas `id → nome` das enumerações usadas na leitura do histórico. */
export interface RedmineEnumerations {
  /** `/issue_statuses.json` */
  readonly status: ReadonlyMap<number, string>;
  /** `/trackers.json` */
  readonly tracker: ReadonlyMap<number, string>;
  /** `/enumerations/issue_priorities.json` */
  readonly priority: ReadonlyMap<number, string>;
}

/** Enumerações vazias — usado quando tudo falha (degradação total). */
const EMPTY: RedmineEnumerations = {
  status: new Map(),
  tracker: new Map(),
  priority: new Map(),
};

/** Entradas memoizadas por instância. */
const memo = new Map<string, Promise<RedmineEnumerations>>();

/** Converte `{ chave: [{id, name}] }` em `Map<id, name>`; erro ⇒ mapa vazio. */
async function fetchMap(http: HttpClient, path: string, key: string): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  try {
    const body = (await http.get(path, {})) as Record<string, unknown>;
    const rows = body[key];
    if (!Array.isArray(rows)) return out;
    for (const row of rows) {
      if (typeof row !== 'object' || row === null) continue;
      const { id, name } = row as { id?: unknown; name?: unknown };
      if (typeof id === 'number' && typeof name === 'string' && name.length > 0) out.set(id, name);
    }
  } catch {
    // Endpoint indisponível/sem permissão: degrada para mapa vazio (o chamador
    // volta a exibir `#id`). Nunca propaga — isto é enriquecimento, não dado
    // essencial do bundle.
  }
  return out;
}

/**
 * Busca (e memoiza) as enumerações da instância.
 *
 * @param http - Client autenticado da instância.
 * @param instanceKey - Chave de memoização (a URL base da instância).
 * @returns Os mapas `id → nome`; vazios nos endpoints que falharem.
 * @example
 * const enums = await fetchEnumerations(http, baseUrl);
 * enums.status.get(12); // 'Estimativa'
 */
export function fetchEnumerations(
  http: HttpClient,
  instanceKey: string,
): Promise<RedmineEnumerations> {
  const cached = memo.get(instanceKey);
  if (cached !== undefined) return cached;

  const pending = (async (): Promise<RedmineEnumerations> => {
    const [status, tracker, priority] = await Promise.all([
      fetchMap(http, '/issue_statuses.json', 'issue_statuses'),
      fetchMap(http, '/trackers.json', 'trackers'),
      fetchMap(http, '/enumerations/issue_priorities.json', 'issue_priorities'),
    ]);
    return { status, tracker, priority };
  })().catch(() => EMPTY);

  memo.set(instanceKey, pending);
  return pending;
}

/** Limpa a memoização (testes e troca de instância). */
export function clearEnumerationsCache(): void {
  memo.clear();
}
