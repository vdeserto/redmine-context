/**
 * Lista compacta em Markdown dos resultados da tool `search_issues` (M1-13).
 *
 * Diferente do bundle completo de uma issue (#16), aqui cada item é UMA linha:
 * id + status + responsável (metadados estruturais, fora da fence) e o assunto
 * isolado numa fence `<untrusted-content>` — reutilizando {@link fenceInline}
 * para manter a MESMA marcação anti prompt-injection do bundle.
 *
 * Determinístico: nenhum timestamp; a ordem é a recebida do chamador (que já
 * reflete a ordenação do Redmine). Avisos de degradação (ex.: `/search`
 * indisponível) são renderizados no corpo, atendendo ao "aviso no payload".
 */

import { fenceInline } from './markdown.js';

/** Item compacto de um resultado de busca (status/responsável já resolvidos). */
export interface SearchListItem {
  /** Id da issue. */
  id: number;
  /** Assunto derivado do Redmine — renderizado dentro da fence untrusted. */
  subject: string | null;
  /** Nome do status (metadado estrutural). */
  status: string;
  /** Nome do responsável, ou placeholder de ausência (metadado estrutural). */
  assignee: string;
}

/** Metadados de renderização da lista: consulta e avisos de degradação. */
export interface SearchListMeta {
  /** Termo full-text usado (renderizado em fence por ser entrada arbitrária). */
  query?: string | undefined;
  /** Avisos a exibir no corpo (ex.: degradação da busca full-text). */
  warnings?: string[] | undefined;
}

/** Placeholder para assunto ausente na página de listagem. */
const ABSENT_SUBJECT = '_(sem assunto)_';

/** Renderiza uma linha compacta de resultado. */
function renderItem(item: SearchListItem): string {
  const subject = item.subject === null ? ABSENT_SUBJECT : fenceInline(item.subject);
  return `- **#${item.id}** — status: ${item.status} — responsável: ${item.assignee} — ${subject}`;
}

/**
 * Renderiza a lista compacta de resultados de busca em Markdown.
 *
 * @param items - Itens já resolvidos (status/responsável em nomes legíveis).
 * @param meta - Consulta e avisos de degradação (ver {@link SearchListMeta}).
 * @returns Documento Markdown terminado por uma quebra de linha.
 * @example
 * const md = buildSearchListMarkdown(
 *   [{ id: 1, subject: 'x', status: 'New', assignee: '(nenhum)' }],
 *   { query: 'x' },
 * );
 */
export function buildSearchListMarkdown(items: SearchListItem[], meta: SearchListMeta = {}): string {
  const lines: string[] = [`# Resultados da busca (${items.length})`, ''];

  if (meta.query !== undefined && meta.query.length > 0) {
    // Consulta é entrada arbitrária do chamador: também vai em fence untrusted.
    lines.push(`Consulta: ${fenceInline(meta.query)}`, '');
  }

  const warnings = meta.warnings ?? [];
  for (const warning of warnings) {
    lines.push(`> Aviso: ${warning}`);
  }
  if (warnings.length > 0) lines.push('');

  if (items.length === 0) {
    lines.push('_(nenhum resultado)_');
  } else {
    for (const item of items) lines.push(renderItem(item));
  }

  return `${lines.join('\n')}\n`;
}
