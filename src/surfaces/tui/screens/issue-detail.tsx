/**
 * Tela de detalhe de issue (#31) — substitui o placeholder mínimo da #29.
 *
 * Carrega a issue completa via `../hooks/use-issue-detail.js`
 * (`getIssue`+`normalizeIssue` do core, DIRETO — sem passar pelo bundle
 * Markdown/JSON, que é o formato de saída da CLI/MCP, não o modelo em
 * memória que esta tela precisa para paginar/rolar o conteúdo). A issue a
 * buscar vem de `./home-selection.js` (`selectedIssueId`, escrito pela home
 * ao empilhar esta tela — ver o JSDoc daquele módulo para o porquê de um
 * contexto compartilhado em vez de props).
 *
 * Layout: metadados (status/prioridade/autor/responsável/datas) FIXOS no
 * topo — nunca rolam — e descrição + histórico de journals dentro de um
 * `../components/scroll-view.tsx` (viewport de altura fixa,
 * `j`/`k`/setas/PgUp/PgDn), para que a tela não quebre o layout mesmo com uma
 * issue com dezenas de journals.
 *
 * `Esc` (atalho global, `../app.tsx`) desempilha normalmente — a home é
 * remontada, mas `selectedIndex` é preservado via `./home-selection.js`
 * (documentado ali). `b` é o atalho local, mesmo padrão de
 * `doctor.tsx`/`config.tsx`.
 *
 * 401 é responsabilidade de `useAuthGuard`, já embutido em
 * `use-issue-detail.js` (mandatório, M2-13/#36) — esta tela só formata o
 * estado `auth-aborted` (neutro) igual aos demais banners de erro.
 *
 * Anexos (#32): seção "Anexos" adicionada ao FIM do mesmo `ScrollView` de
 * descrição/journals (nunca em área fixa própria) — nome, tamanho humanizado
 * (`../format-file-size.js`) e badge de status de extração
 * (`../attachment-status.js`, mapeamento local documentado ali — o core ainda
 * não expõe `ExtractionResult['status']`). Entrar no MESMO viewport rolável
 * garante o AC "navegação nunca bloqueia por causa de anexos": uma issue com
 * dezenas de anexos apenas acrescenta linhas à rolagem existente, sem tela
 * própria, sem fetch adicional e sem novo atalho de teclado.
 */
import { Box, Text, useInput } from 'ink';
import type { ReactNode } from 'react';

import type { Attachment, Issue } from '../../../index.js';
import {
  attachmentStatusColor,
  attachmentStatusLabel,
  deriveAttachmentExtractionStatus,
} from '../attachment-status.js';
import { Spinner } from '../components/spinner.js';
import { ScrollView } from '../components/scroll-view.js';
import { humanizeFileSize } from '../format-file-size.js';
import { useIssueDetail } from '../hooks/use-issue-detail.js';
import { useNavigation } from '../navigation.js';
import { statusColor } from '../status-color.js';
import { symbols } from '../symbols.js';
import { useTheme, type Theme } from '../theme.js';
import { useHomeSelection } from './home-selection.js';

/** Altura (em linhas) da viewport rolável de descrição + journals. */
const CONTENT_HEIGHT = 10;

/** Placeholder discreto para campos ausentes (assignee, autor/data de journal, old/new value). */
const EMPTY_PLACEHOLDER = '—';

/** Metadados fixos no topo: id/subject, status/prioridade, autor/responsável, datas. */
function IssueMeta({ issue, theme }: { issue: Issue; theme: Theme }) {
  return (
    <Box flexDirection="column">
      <Text bold color={theme.primary}>
        #{issue.id} {issue.subject}
      </Text>
      <Box>
        <Text color={statusColor(theme, issue.status.name)}>[{issue.status.name}]</Text>
        <Text> </Text>
        <Text color={theme.accent}>{issue.priority.name}</Text>
      </Box>
      <Box>
        <Text color={theme.muted}>Autor: </Text>
        <Text>{issue.author.name}</Text>
        <Text color={theme.muted}> Responsável: </Text>
        <Text>{issue.assigned_to?.name ?? EMPTY_PLACEHOLDER}</Text>
      </Box>
      <Box>
        <Text color={theme.muted}>Criada em: </Text>
        <Text>{issue.created_on}</Text>
        <Text color={theme.muted}> Atualizada em: </Text>
        <Text>{issue.updated_on}</Text>
      </Box>
    </Box>
  );
}

/** Constrói a linha de um único anexo: nome (texto derivado, puro) · tamanho humanizado · content_type · badge de status. */
function buildAttachmentRow(attachment: Attachment, theme: Theme): ReactNode {
  const status = deriveAttachmentExtractionStatus(attachment);
  return (
    <Text key={`attachment-${attachment.id}`}>
      {attachment.filename}{' '}
      <Text color={theme.muted}>
        ({humanizeFileSize(attachment.filesize)} · {attachment.content_type ?? EMPTY_PLACEHOLDER})
      </Text>{' '}
      <Text bold color={attachmentStatusColor(theme, status)}>
        [{attachmentStatusLabel(status)}]
      </Text>
    </Text>
  );
}

/** Constrói as linhas da seção de anexos (após os journals): cabeçalho + 1 linha por anexo, ou "(nenhum)". */
function buildAttachmentRows(issue: Issue, theme: Theme): ReactNode[] {
  const rows: ReactNode[] = [
    <Text bold color={theme.primary} key="attachments-header">
      Anexos
    </Text>,
  ];
  if (issue.attachments.length === 0) {
    rows.push(
      <Text color={theme.muted} key="attachments-empty">
        (nenhum)
      </Text>,
    );
  } else {
    issue.attachments.forEach((attachment) => {
      rows.push(buildAttachmentRow(attachment, theme));
    });
  }
  return rows;
}

/** Constrói as linhas da viewport rolável: bloco de descrição + histórico cronológico de journals. */
function buildContentRows(issue: Issue, theme: Theme): ReactNode[] {
  const rows: ReactNode[] = [];

  rows.push(
    <Text bold color={theme.primary} key="desc-header">
      Descrição
    </Text>,
  );
  if (issue.description === undefined || issue.description === '') {
    rows.push(
      <Text color={theme.muted} key="desc-empty">
        (sem descrição)
      </Text>,
    );
  } else {
    issue.description.split('\n').forEach((line, index) => {
      rows.push(<Text key={`desc-${index}`}>{line.length > 0 ? line : ' '}</Text>);
    });
  }
  rows.push(<Text key="desc-spacer"> </Text>);

  rows.push(
    <Text bold color={theme.primary} key="journals-header">
      Histórico
    </Text>,
  );
  if (issue.journals.length === 0) {
    rows.push(
      <Text color={theme.muted} key="journals-empty">
        (nenhuma atualização registrada)
      </Text>,
    );
  } else {
    // Cronológico: preserva a ordem já entregue por `getIssue`/`normalizeIssue`.
    issue.journals.forEach((journal) => {
      rows.push(
        <Text color={theme.muted} key={`journal-${journal.id}-head`}>
          {journal.user?.name ?? EMPTY_PLACEHOLDER} · {journal.created_on}
        </Text>,
      );
      if (journal.notes !== undefined && journal.notes !== '') {
        journal.notes.split('\n').forEach((line, index) => {
          rows.push(<Text key={`journal-${journal.id}-note-${index}`}>{line}</Text>);
        });
      }
      // Details estruturais resumidos: `campo: antigo → novo`, sempre em muted.
      journal.details.forEach((detail, index) => {
        rows.push(
          <Text color={theme.muted} key={`journal-${journal.id}-detail-${index}`}>
            {'  '}
            {detail.name}: {detail.old_value ?? EMPTY_PLACEHOLDER} {symbols.arrowRight}{' '}
            {detail.new_value ?? EMPTY_PLACEHOLDER}
          </Text>,
        );
      });
      rows.push(<Text key={`journal-${journal.id}-spacer`}> </Text>);
    });
  }

  rows.push(<Text key="journals-attachments-spacer"> </Text>);
  // Anexos (#32) SEMPRE por último — após journals, dentro do mesmo ScrollView.
  rows.push(...buildAttachmentRows(issue, theme));

  return rows;
}

/** Rodapé com os atalhos disponíveis nesta tela. */
function Footer({ showRetry }: { showRetry: boolean }) {
  const theme = useTheme();
  return (
    <Box marginTop={1}>
      <Text color={theme.muted}>
        {showRetry ? (
          <>
            Pressione{' '}
            <Text bold color={theme.accent}>
              r
            </Text>{' '}
            para tentar de novo,{' '}
          </>
        ) : null}
        Pressione{' '}
        <Text bold color={theme.accent}>
          b
        </Text>{' '}
        para voltar.
      </Text>
    </Box>
  );
}

/**
 * Tela de detalhe: metadados fixos + descrição/journals em viewport rolável.
 * `b` (ou `Esc`, atalho global) volta para a home — `selectedIndex` da lista
 * é preservado via `./home-selection.js`.
 */
export function IssueDetailScreen() {
  const { pop } = useNavigation();
  const theme = useTheme();
  const { selectedIssueId } = useHomeSelection();
  const { state, retry } = useIssueDetail(selectedIssueId);

  useInput((input) => {
    if (input === 'b') {
      pop();
      return;
    }
    if (
      input === 'r' &&
      (state.status === 'error-network' ||
        state.status === 'error-forbidden' ||
        state.status === 'error-not-found' ||
        state.status === 'auth-aborted')
    ) {
      retry();
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold color={theme.primary}>
        Detalhe da issue
      </Text>

      {state.status === 'no-selection' ? (
        <Box marginTop={1}>
          <Text color={theme.muted}>Nenhuma issue selecionada.</Text>
        </Box>
      ) : null}

      {state.status === 'loading' ? (
        <Box marginTop={1}>
          <Text>
            <Spinner /> Carregando issue...
          </Text>
        </Box>
      ) : null}

      {state.status === 'error-network' ? (
        <Box marginTop={1}>
          <Text color={theme.danger}>
            {symbols.cross} Falha ao carregar a issue: {state.message}
          </Text>
        </Box>
      ) : null}

      {state.status === 'error-forbidden' ? (
        <Box marginTop={1}>
          <Text color={theme.danger}>
            {symbols.cross} {state.message}
          </Text>
        </Box>
      ) : null}

      {state.status === 'error-not-found' ? (
        <Box marginTop={1}>
          <Text color={theme.danger}>
            {symbols.cross} {state.message}
          </Text>
        </Box>
      ) : null}

      {state.status === 'auth-aborted' ? (
        <Box marginTop={1}>
          <Text color={theme.muted}>{state.message}</Text>
        </Box>
      ) : null}

      {state.status === 'loaded' ? (
        <Box marginTop={1} flexDirection="column">
          <IssueMeta issue={state.issue} theme={theme} />
          <Box marginTop={1}>
            <ScrollView lines={buildContentRows(state.issue, theme)} height={CONTENT_HEIGHT} />
          </Box>
        </Box>
      ) : null}

      <Footer
        showRetry={
          state.status === 'error-network' ||
          state.status === 'error-forbidden' ||
          state.status === 'error-not-found' ||
          state.status === 'auth-aborted'
        }
      />
    </Box>
  );
}
