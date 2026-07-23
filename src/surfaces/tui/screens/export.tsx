/**
 * Tela de exportação do bundle (#33) — aberta a partir do detalhe da issue
 * (`e`, ver `./issue-detail.tsx`), SOMENTE quando a issue já terminou de
 * carregar (`state.status === 'loaded'` naquela tela).
 *
 * Reusa a issue já normalizada em memória via `./loaded-issue-context.js`
 * (ver o JSDoc daquele módulo para a escolha de reuso vs. refetch) e chama
 * `../hooks/use-export-bundle.js`, que empacota com `buildMarkdownBundle`/
 * `buildJsonBundle` (fronteira do core, `../../../index.js`) e grava
 * `<id>.md`/`<id>.json` no destino informado.
 *
 * Dois campos alternados por `Tab` (mesmo padrão de
 * `./onboarding/login.tsx`): formato — lista navegável (↑/↓,
 * `../hooks/use-list-navigation.js`) entre `md`/`json`/`both` — e destino —
 * `../components/text-input.js`, com `process.cwd()` como valor inicial
 * (`~` é expandido pelo hook antes de gravar). `Enter` em qualquer um dos
 * dois campos confirma a exportação.
 *
 * 4 estados visuais: formulário (`idle`), progresso (`Spinner` existente,
 * igual a `./issue-detail.tsx`), sucesso (caminho(s) absoluto(s) gravado(s) +
 * `b` para voltar) e erro (`theme.danger` + ação corretiva — diretório
 * inexistente ou sem permissão de escrita, ver o hook). `b` (ou `Esc`, atalho
 * global de `../app.tsx`) volta ao detalhe em qualquer estado que não seja
 * `exporting` — a pilha já preserva a navegação (a issue é buscada de novo
 * pelo detalhe ao remontar, mesmo comportamento já existente ao voltar da
 * home para o detalhe).
 */
import { Box, Text, useInput } from 'ink';
import { useCallback, useRef, useState } from 'react';

import { Spinner } from '../components/spinner.js';
import { TextInput } from '../components/text-input.js';
import { useExportBundle, type ExportFormat } from '../hooks/use-export-bundle.js';
import { useListNavigation } from '../hooks/use-list-navigation.js';
import { useNavigation } from '../navigation.js';
import { symbols } from '../symbols.js';
import { useTheme } from '../theme.js';
import { useLoadedIssue } from './loaded-issue-context.js';

/** Campo com foco no formulário — só um controle reage ao teclado por vez (`Tab` alterna). */
type Field = 'format' | 'destination';

/** Alterna entre os dois campos do formulário. */
function otherField(field: Field): Field {
  return field === 'format' ? 'destination' : 'format';
}

/** Opção de formato navegável: valor real do hook + rótulo legível. */
interface FormatOption {
  value: ExportFormat;
  label: string;
}

/** As 3 opções de formato exigidas pela AC: MD, JSON, ou ambos. */
const FORMAT_OPTIONS: readonly FormatOption[] = [
  { value: 'md', label: 'Markdown (.md)' },
  { value: 'json', label: 'JSON (.json)' },
  { value: 'both', label: 'Ambos (.md + .json)' },
];

/** Uma linha da lista de formato: ponteiro quando é a linha selecionada, negrito quando o campo está focado. */
function FormatRow({ label, selected, focused }: { label: string; selected: boolean; focused: boolean }) {
  const theme = useTheme();
  return (
    <Box>
      <Text color={theme.primary}>{selected ? `${symbols.pointerSmall} ` : '  '}</Text>
      <Text bold={selected} color={selected && focused ? theme.primary : theme.muted}>
        {label}
      </Text>
    </Box>
  );
}

/** Tela de exportação: escolhe formato + destino, grava via o core, mostra progresso/sucesso/erro. */
export function ExportScreen() {
  const theme = useTheme();
  const { pop } = useNavigation();
  const { issue } = useLoadedIssue();
  const { state, runExport, reset } = useExportBundle(issue);

  const [field, setField] = useState<Field>('format');
  const [destination, setDestination] = useState(() => process.cwd());

  const isFormActive = state.status === 'idle';

  const handleSubmit = useCallback(
    (formatIndex: number) => {
      const format = FORMAT_OPTIONS[formatIndex]?.value ?? 'md';
      void runExport(format, destination);
    },
    [runExport, destination],
  );

  const { selectedIndex: formatIndex } = useListNavigation(FORMAT_OPTIONS.length, {
    isActive: isFormActive && field === 'format',
    onSelect: handleSubmit,
  });

  // Handlers ESTÁVEIS (refs + useCallback, padrão do repo): identidade nova a
  // cada render des/re-subscreve o useInput e pode perder uma tecla rápida.
  const stateStatusRef = useRef(state.status);
  stateStatusRef.current = state.status;
  const popRef = useRef(pop);
  popRef.current = pop;
  const resetRef = useRef(reset);
  resetRef.current = reset;

  const handleControlInput = useCallback((input: string, key: { tab: boolean }) => {
    if (key.tab && stateStatusRef.current === 'idle') {
      setField(otherField);
      return;
    }
    // "b" não interrompe uma exportação em andamento — evita voltar no meio
    // de uma gravação em disco.
    if (input === 'b' && stateStatusRef.current !== 'exporting') {
      popRef.current();
      return;
    }
    if (input === 'r' && stateStatusRef.current === 'error') {
      resetRef.current();
    }
  }, []);
  useInput(handleControlInput);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold color={theme.primary}>
        Exportar bundle
      </Text>

      {issue === undefined ? (
        <Box marginTop={1}>
          <Text color={theme.muted}>Nenhuma issue carregada — volte ao detalhe e tente de novo.</Text>
        </Box>
      ) : null}

      {issue !== undefined && state.status === 'idle' ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.muted}>Issue #{issue.id}</Text>

          <Box marginTop={1} flexDirection="column">
            <Text color={field === 'format' ? theme.primary : theme.muted}>Formato:</Text>
            {FORMAT_OPTIONS.map((option, index) => (
              <FormatRow
                key={option.value}
                label={option.label}
                selected={index === formatIndex}
                focused={field === 'format'}
              />
            ))}
          </Box>

          <Box marginTop={1}>
            <Text color={field === 'destination' ? theme.primary : theme.muted}>
              {field === 'destination' ? symbols.pointer : ' '} Destino:{' '}
            </Text>
            <TextInput
              value={destination}
              onChange={setDestination}
              onSubmit={() => handleSubmit(formatIndex)}
              isActive={field === 'destination'}
            />
          </Box>
        </Box>
      ) : null}

      {state.status === 'exporting' ? (
        <Box marginTop={1}>
          <Text>
            <Spinner /> Exportando...
          </Text>
        </Box>
      ) : null}

      {state.status === 'success' ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.success}>{symbols.tick} Bundle gravado:</Text>
          {state.files.map((file) => (
            <Text color={theme.muted} key={file.path}>
              {'  '}
              {file.path}
            </Text>
          ))}
        </Box>
      ) : null}

      {state.status === 'error' ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.danger}>
            {symbols.cross} Falha ao gravar o bundle: {state.message}
          </Text>
          <Text color={theme.muted}>
            Verifique se o diretório existe e se você tem permissão de escrita nele, ou informe outro
            destino.
          </Text>
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Text color={theme.muted}>
          {state.status === 'idle' ? (
            <>
              <Text bold color={theme.accent}>
                ↑/↓
              </Text>{' '}
              escolhe o formato,{' '}
              <Text bold color={theme.accent}>
                Tab
              </Text>{' '}
              alterna formato/destino,{' '}
              <Text bold color={theme.accent}>
                Enter
              </Text>{' '}
              exporta,{' '}
            </>
          ) : null}
          {state.status === 'error' ? (
            <>
              <Text bold color={theme.accent}>
                r
              </Text>{' '}
              tenta de novo,{' '}
            </>
          ) : null}
          <Text bold color={theme.accent}>
            b
          </Text>{' '}
          volta ao detalhe.
        </Text>
      </Box>
    </Box>
  );
}
