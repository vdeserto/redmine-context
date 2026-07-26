/**
 * Painel de jobs da sessão (#34/M2-11) — empilhado a partir da home
 * (`./home.tsx`) ou do detalhe (`./issue-detail.tsx`) com a tecla `t`
 * ("tarefas"), disponível em qualquer estado das duas telas.
 *
 * Lista as operações registradas em `../job-registry.tsx` (ver o JSDoc
 * daquele módulo para o contrato completo) — hoje só a exportação de bundle
 * (`./export.tsx`, #33) é um produtor real; a tela já está pronta para
 * qualquer job futuro do M3/M4 sem mudança de contrato.
 *
 * ## `ink-task-list`: incompatibilidade verificada, componente próprio
 *
 * A AC pedia `ink-task-list` (já na dependência do projeto) OU um componente
 * próprio "se a lib conflitar com ink@6". Testado manualmente antes de
 * qualquer implementação (`ink-testing-library` + `ink-task-list@2.0.0`):
 *
 * 1. **Sem export default** — só exporta `{ Task, TaskList }` nomeados (o
 *    típico `import TaskList, { Task } from 'ink-task-list'` sugerido pela
 *    doc da lib quebra com `ink@6`/ESM estrito).
 * 2. **Cores hardcoded internas** (amarelo/vermelho/verde/cinza fixos no
 *    próprio bundle da lib) — incompatível com a AC "cores do tema": a
 *    varredura anti-hardcode do repo (`tests/surfaces/tui/no-hardcoded-colors.test.ts`)
 *    só cobre `src/surfaces/tui`, então isso não quebraria o CI, mas o
 *    resultado visual NUNCA respeitaria um tema customizado — justamente o
 *    problema que `theme.ts` existe para resolver.
 * 3. O estado `'loading'` da lib **exige** um prop `spinner` explícito
 *    (`{ frames, interval }`, sem default) — omiti-lo quebra o render com
 *    `Cannot read properties of undefined (reading 'frames')`. Contornável
 *    passando um objeto de frames à mão, mas é mais um sinal de uma lib
 *    parada na era do ink@3 (suas `devDependencies` fixam `ink@^3.2.0` e
 *    `react@^17.0.2`).
 *
 * Dado o conflito real com a AC de tema (item 2) e a fragilidade do item 3,
 * a escolha foi um componente próprio, reaproveitando peças já existentes:
 * `../symbols.ts` (ícones, com fallback ASCII automático) para os estados
 * estáticos e o `Spinner` (`../components/spinner.tsx`) já usado por
 * `./export.tsx`/`./home.tsx` para `processing` — ver `../job-status.ts` para
 * o mapeamento ícone/cor por status.
 */
import { Box, Text, useInput } from 'ink';
import { useRef } from 'react';

import { Spinner } from '../components/spinner.js';
import { glyphs } from '../glyphs.js';
import { useListNavigation } from '../hooks/use-list-navigation.js';
import { useJobRegistry, type Job } from '../job-registry.js';
import { jobStatusColor, jobStatusIcon, jobStatusLabel } from '../job-status.js';
import { useNavigation } from '../navigation.js';
import { symbols } from '../symbols.js';
import { useTheme, type Theme } from '../theme.js';

/** Uma linha do painel: ícone/spinner de status, rótulo, badge textual e, quando selecionada, o hint de cancelamento. */
function JobRow({ job, selected, theme }: { job: Job; selected: boolean; theme: Theme }) {
  const icon = jobStatusIcon(job.status);
  return (
    <Box>
      <Text color={theme.primary}>{selected ? `${symbols.pointerSmall} ` : '  '}</Text>
      {job.status === 'processing' ? (
        <Spinner />
      ) : (
        <Text color={jobStatusColor(theme, job.status)}>{icon}</Text>
      )}
      <Text> </Text>
      <Text bold={selected}>{job.label}</Text>
      <Text color={theme.muted}> [{jobStatusLabel(job.status)}]</Text>
      {selected ? (
        <Text color={theme.muted}>
          {' '}
          {job.cancelable === true ? '(Ctrl+C cancela)' : '(não cancelável)'}
        </Text>
      ) : null}
    </Box>
  );
}

/**
 * Tela do painel de jobs: lista as operações da sessão (`../job-registry.tsx`),
 * `↑/↓`/`j`/`k` navegam a seleção, `Ctrl+C` cancela o job selecionado (só se
 * `cancelable`, ver o JSDoc de `../job-registry.tsx`), `b` (ou `Esc`, atalho
 * global) volta.
 */
export function JobsScreen() {
  const theme = useTheme();
  const { pop } = useNavigation();
  const { jobs } = useJobRegistry();

  const { selectedIndex } = useListNavigation(jobs.length);

  // Handlers ESTÁVEIS (refs + useCallback via closures simples aqui, padrão
  // do repo): identidade nova a cada render des/re-subscreve o useInput e
  // pode perder uma tecla rápida entre pressões próximas.
  const popRef = useRef(pop);
  popRef.current = pop;
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;

  useInput((input, key) => {
    if (input === 'b') {
      popRef.current();
      return;
    }
    if (key.ctrl && input === 'c') {
      const selectedJob = jobsRef.current[selectedIndexRef.current];
      if (selectedJob?.cancelable === true) {
        selectedJob.onCancel?.();
      }
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold color={theme.primary}>
        Jobs da sessão
      </Text>

      {jobs.length === 0 ? (
        <Box marginTop={1}>
          <Text color={theme.muted}>Nenhum job nesta sessão ainda.</Text>
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
          {jobs.map((job, index) => (
            <JobRow key={job.id} job={job} selected={index === selectedIndex} theme={theme} />
          ))}
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={theme.muted}>
          <Text bold color={theme.accent}>
            {`${glyphs.arrowUp}/${glyphs.arrowDown}`}
          </Text>{' '}
          navega,{' '}
          <Text bold color={theme.accent}>
            Ctrl+C
          </Text>{' '}
          cancela o job selecionado (se cancelável),{' '}
          <Text bold color={theme.accent}>
            b
          </Text>{' '}
          volta.
        </Text>
      </Box>
    </Box>
  );
}
