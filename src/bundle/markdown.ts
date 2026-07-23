/**
 * Bundle Markdown determinístico de uma issue normalizada (issue #16, ADR-005).
 *
 * Renderiza uma {@link Issue} num documento Markdown legível por humanos e por
 * LLMs, mantendo as MESMAS invariantes do bundle JSON (#15):
 *
 * 1. Determinismo: coleções recebem a ordenação estável DECLARADA — reutilizada
 *    de `./json.ts` ({@link compareJournals}, {@link byId}) sem duplicar a regra.
 *    Dois bundles do mesmo estado são byte-idênticos; não há `generated_at` no
 *    corpo (o timestamp vive apenas no envelope do JSON, #15).
 * 2. Anti prompt-injection: TODO conteúdo textual derivado do Redmine (subject,
 *    descrição, notas de journal, valores de custom field, nomes e descrições de
 *    anexo, subjects de filhos) é isolado dentro de fences
 *    `<untrusted-content>...</untrusted-content>`. Este é EXATAMENTE o conjunto
 *    marcado `untrusted: true` no JSON, acrescido do nome do anexo (M1-10).
 *    Metadados estruturais (ids, datas, nomes de campos padrão, URLs) ficam fora.
 * 3. Refs degradadas: o `NULL_REF` do normalize (`id === 0`) é renderizado como
 *    "(desconhecido)" — nunca como um nome vazio silencioso.
 *
 * No M1 os anexos são texto-only: referenciados pela URL de download do Redmine,
 * sem baixar o binário.
 */

import type {
  Attachment,
  CustomField,
  ExtractionResult,
  Issue,
  IssueChild,
  IssueRelation,
  Journal,
  RedmineRef,
} from '../contract.js';
import { byId, compareJournals, type ExtractionMap } from './json.js';

/** Metadados de empacotamento do bundle Markdown (sem timestamp — determinismo). */
export interface MarkdownBundleMeta {
  /** Base URL do Redmine de origem — compõe as URLs de download dos anexos. */
  baseUrl: string;
  /** Versão da ferramenta (`TOOL_VERSION`), registrada no rodapé de proveniência. */
  toolVersion: string;
  /**
   * Extrações de anexos (M3-10). Quando presente, cada anexo com resultado ganha
   * a seção "Texto extraído" — o texto de OCR dentro de `<untrusted-content>`.
   */
  extractions?: ExtractionMap;
}

/** Placeholder para ref degradada (id 0) — nunca um nome vazio silencioso. */
const UNKNOWN_REF = '(desconhecido)';
/** Placeholder para ref opcional ausente (distinto de degradada). */
const ABSENT_REF = '(nenhum)';

/**
 * Neutraliza tentativas de fuga da fence embutidas no conteúdo não confiável.
 *
 * Reason: um valor do Redmine pode conter literalmente `</untrusted-content>`
 * para "fechar" a fence e injetar instruções fora dela. Inserimos um espaço de
 * largura zero após o `<` de qualquer tag de fence, preservando o texto visível
 * mas quebrando o token — de forma determinística.
 *
 * @param text - Conteúdo bruto derivado do Redmine.
 * @returns Texto com tokens de fence defangados.
 */
function neutralizeFence(text: string): string {
  // Tolerante a espaços internos: "< /untrusted-content >" também fecharia o
  // fence aos olhos de um LLM — normaliza qualquer variante.
  return text.replace(/<\s*(\/?)\s*untrusted-content\s*>/gi, '<​$1untrusted-content>');
}

/**
 * Isola conteúdo não confiável num bloco `<untrusted-content>` de várias linhas.
 *
 * @param text - Conteúdo derivado do Redmine.
 * @returns Bloco fence pronto para inserção como seção.
 */
function fenceBlock(text: string): string {
  return `<untrusted-content>\n${neutralizeFence(text)}\n</untrusted-content>`;
}

/**
 * Isola conteúdo não confiável numa fence inline (uma linha).
 *
 * Exportada para ser reutilizada por outros renderizadores do bundle (ex.: a
 * lista compacta de resultados de busca, M1-13) sem duplicar a marcação
 * anti prompt-injection.
 *
 * @param text - Conteúdo derivado do Redmine.
 * @returns Fence inline `<untrusted-content>...</untrusted-content>`.
 */
export function fenceInline(text: string): string {
  return `<untrusted-content>${neutralizeFence(text)}</untrusted-content>`;
}

/**
 * Nome legível de uma ref obrigatória, tratando degradação.
 *
 * @param ref - Ref do contrato (possivelmente o placeholder `id === 0`).
 * @returns Nome real ou "(desconhecido)" para o placeholder degradado.
 */
function refName(ref: RedmineRef): string {
  return ref.id === 0 ? UNKNOWN_REF : ref.name;
}

/** Nome de uma ref opcional; ausência → "(nenhum)", degradada → "(desconhecido)". */
function optionalRefName(ref: RedmineRef | undefined): string {
  return ref === undefined ? ABSENT_REF : refName(ref);
}

/** Achata o valor de um custom field (multi-valor → lista separada por vírgula). */
function customFieldText(value: CustomField['value']): string | null {
  if (value === null) return null;
  return Array.isArray(value) ? value.join(', ') : value;
}

/** Cabeçalho + assunto (fenced) + metadados estruturais da issue. */
function renderHeader(issue: Issue): string {
  const lines: string[] = [`# Issue #${issue.id}`, '', '## Assunto', '', fenceBlock(issue.subject), ''];
  lines.push('## Metadados', '');
  lines.push(`- **Projeto:** ${refName(issue.project)}`);
  lines.push(`- **Tracker:** ${refName(issue.tracker)}`);
  lines.push(`- **Status:** ${refName(issue.status)}`);
  lines.push(`- **Prioridade:** ${refName(issue.priority)}`);
  lines.push(`- **Autor:** ${refName(issue.author)}`);
  lines.push(`- **Responsável:** ${optionalRefName(issue.assigned_to)}`);
  lines.push(`- **Criada em:** ${issue.created_on}`);
  lines.push(`- **Atualizada em:** ${issue.updated_on}`);
  if (issue.done_ratio !== undefined) lines.push(`- **Progresso:** ${issue.done_ratio}%`);
  if (issue.start_date !== undefined) lines.push(`- **Início:** ${issue.start_date}`);
  if (issue.due_date !== undefined) lines.push(`- **Prazo:** ${issue.due_date}`);
  return lines.join('\n');
}

/** Seção de descrição (fenced) — placeholder estrutural quando ausente. */
function renderDescription(issue: Issue): string {
  const body = issue.description === undefined ? '_(sem descrição)_' : fenceBlock(issue.description);
  return `## Descrição\n\n${body}`;
}

/** Seção de custom fields — nome do campo (metadado) + valor (fenced). */
function renderCustomFields(issue: Issue): string {
  if (issue.custom_fields.length === 0) return '## Custom Fields\n\n_(nenhum)_';
  const rows = byId(issue.custom_fields).map((field) => {
    const text = customFieldText(field.value);
    const value = text === null ? '_(vazio)_' : fenceInline(text);
    // O nome do custom field é definido pelo admin da instância — derivado.
    return `- **${fenceInline(field.name)}:** ${value}`;
  });
  return ['## Custom Fields', '', ...rows].join('\n');
}

/**
 * Renderiza os `details` de um journal. `name` e old/new_value são derivados
 * (em details de "description"/"subject" os values carregam o texto completo
 * do campo) — todos passam pelo fence inline.
 */
function renderJournalDetails(journal: Journal): string[] {
  return journal.details.map((detail) => {
    const from = detail.old_value === null || detail.old_value === undefined ? '∅' : fenceInline(detail.old_value);
    const to = detail.new_value === null || detail.new_value === undefined ? '∅' : fenceInline(detail.new_value);
    return `  - ${fenceInline(detail.name)}: ${from} → ${to}`;
  });
}

/** Renderiza uma entrada de journal: cabeçalho estrutural + nota (fenced). */
function renderJournal(journal: Journal): string {
  const lines: string[] = [`### Journal #${journal.id} — ${journal.created_on} — ${optionalRefName(journal.user)}`, ''];
  const details = renderJournalDetails(journal);
  if (details.length > 0) lines.push('Alterações:', ...details, '');
  if (journal.notes !== undefined) lines.push('Nota:', fenceBlock(journal.notes), '');
  if (details.length === 0 && journal.notes === undefined) lines.push('_(sem alterações ou notas)_', '');
  return lines.join('\n').trimEnd();
}

/** Seção de histórico — journals em ordem cronológica estável (created_on, id). */
function renderJournals(issue: Issue): string {
  if (issue.journals.length === 0) return '## Histórico\n\n_(nenhum)_';
  const ordered = [...issue.journals].sort(compareJournals).map(renderJournal);
  return ['## Histórico', ...ordered].join('\n\n');
}

/** Seção de relações — tipo + issue alvo (tudo estrutural). */
function renderRelations(issue: Issue): string {
  if (issue.relations.length === 0) return '## Relações\n\n_(nenhuma)_';
  const rows = byId(issue.relations).map((rel: IssueRelation) => {
    const delay = rel.delay === undefined || rel.delay === null ? '' : ` (atraso: ${rel.delay}d)`;
    return `- **${rel.relation_type}** → issue #${rel.issue_to_id}${delay}`;
  });
  return ['## Relações', '', ...rows].join('\n');
}

/** Seção do pai — referência estrutural por número de issue. */
function renderParent(issue: Issue): string {
  const body = issue.parent === undefined ? '_(nenhuma)_' : `- issue #${issue.parent.id}`;
  return `## Issue Pai\n\n${body}`;
}

/** Renderiza uma issue-filha: id/tracker estruturais + subject (fenced). */
function renderChild(child: IssueChild): string {
  const tracker = child.tracker === undefined ? '' : ` [${refName(child.tracker)}]`;
  const subject = child.subject === undefined ? '' : ` ${fenceInline(child.subject)}`;
  return `- issue #${child.id}${tracker}${subject}`;
}

/** Seção de sub-issues — filhos ordenados por id. */
function renderChildren(issue: Issue): string {
  if (issue.children.length === 0) return '## Sub-issues\n\n_(nenhuma)_';
  const rows = byId(issue.children).map(renderChild);
  return ['## Sub-issues', '', ...rows].join('\n');
}

/**
 * Renderiza a seção "Texto extraído" de um anexo (M3-10). O texto de OCR é
 * conteúdo DERIVADO do anexo, logo isolado dentro de `<untrusted-content>`. Quando
 * não há texto (skip/falha/unsupported), mostra `status` + `reason`/`hint` — assim
 * o bundle continua saindo e, no caso de tesseract ausente, DIZ como instalar.
 *
 * @param result - Resultado da extração do anexo.
 * @returns Linhas Markdown da seção (para concatenar ao bloco do anexo).
 */
function renderExtraction(result: ExtractionResult): string[] {
  if (typeof result.text === 'string' && result.text.trim() !== '') {
    return [`  - Texto extraído (${result.status}):`, fenceBlock(result.text)];
  }
  const lines = [`  - Texto extraído (${result.status}):`];
  const reason = result.metadata?.['reason'];
  const hint = result.metadata?.['hint'];
  if (typeof reason === 'string') lines.push(`    - Motivo: ${reason}`);
  // `hint` é texto NOSSO (não do Redmine) — ex.: instruções de instalação; fica
  // fora da fence untrusted por ser confiável.
  if (typeof hint === 'string') lines.push(`    - ${hint}`);
  if (typeof reason !== 'string' && typeof hint !== 'string') lines.push('    - _(sem texto)_');
  return lines;
}

/**
 * Renderiza um anexo: metadados estruturais + URL de download do Redmine.
 *
 * O nome e a descrição (conteúdo derivado) vão em fence; a URL usa o filename
 * percent-encoded como componente de caminho, mantendo-a válida e imune a fuga.
 * Quando há extração (M3-10), acrescenta a seção "Texto extraído".
 *
 * @param att - Anexo normalizado.
 * @param baseUrl - Base URL do Redmine.
 * @param extractions - Extrações por anexo; `undefined` = sem extração.
 * @returns Bloco Markdown do anexo.
 */
function renderAttachment(att: Attachment, baseUrl: string, extractions: ExtractionMap | undefined): string {
  const url = `${baseUrl}/attachments/download/${att.id}/${encodeURIComponent(att.filename)}`;
  const lines: string[] = [`- **Anexo #${att.id}** — ${att.filesize} bytes`];
  lines.push(`  - Nome: ${fenceInline(att.filename)}`);
  lines.push(`  - URL: ${url}`);
  if (att.description !== undefined) lines.push(`  - Descrição: ${fenceInline(att.description)}`);
  const extraction = extractions?.get(att.id);
  if (extraction !== undefined) lines.push(...renderExtraction(extraction));
  return lines.join('\n');
}

/** Seção de anexos — referenciados por URL do Redmine, ordenados por id. */
function renderAttachments(issue: Issue, baseUrl: string, extractions: ExtractionMap | undefined): string {
  if (issue.attachments.length === 0) return '## Anexos\n\n_(nenhum)_';
  const rows = byId(issue.attachments).map((att) => renderAttachment(att, baseUrl, extractions));
  return ['## Anexos', '', ...rows].join('\n');
}

/**
 * Empacota uma issue normalizada num documento Markdown determinístico.
 *
 * O corpo é byte-idêntico entre execuções do mesmo estado (ordenação estável
 * reutilizada do JSON + ausência de `generated_at`). Todo conteúdo textual
 * derivado do Redmine é isolado em fences `<untrusted-content>`.
 *
 * @param issue - Issue normalizada (ver `src/normalize`).
 * @param meta - Base URL do Redmine e versão da ferramenta.
 * @returns Documento Markdown completo, terminado por uma quebra de linha.
 * @example
 * const md = buildMarkdownBundle(issue, {
 *   baseUrl: 'https://redmine.example',
 *   toolVersion: TOOL_VERSION,
 * });
 */
export function buildMarkdownBundle(issue: Issue, meta: MarkdownBundleMeta): string {
  const sections: string[] = [
    renderHeader(issue),
    renderDescription(issue),
    renderCustomFields(issue),
    renderJournals(issue),
    renderRelations(issue),
    renderParent(issue),
    renderChildren(issue),
    renderAttachments(issue, meta.baseUrl, meta.extractions),
    `---\n\n_Empacotado por redmine-context v${meta.toolVersion}._`,
  ];
  return `${sections.join('\n\n')}\n`;
}
