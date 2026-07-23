/**
 * Registro leve de jobs da sessão (#34/M2-11) — fonte de dados do painel de
 * jobs (`./screens/jobs.tsx`, tecla `t` na home/detalhe).
 *
 * Mesmo padrão de `./screens/home-selection.tsx`/`./screens/loaded-issue-context.tsx`
 * (ver o JSDoc de qualquer um dos dois para as alternativas descartadas —
 * singleton de módulo vazaria estado entre testes; guardar isto dentro de
 * `NavigationValue` acoplaria o roteador a um detalhe de produtores
 * específicos): instanciado uma vez em `./app.tsx`, ACIMA da pilha de
 * navegação, para que jobs sobrevivam ao push/pop de telas — iniciar uma
 * exportação (`./screens/export.tsx`), navegar para outra tela e voltar ainda
 * deve mostrar o job (em andamento ou já concluído) no painel.
 *
 * ## Contrato para produtores futuros (M3/M4 — extração de anexos)
 *
 * Qualquer operação assíncrona da sessão que o usuário deva acompanhar
 * (exportação hoje; extração de imagem/PDF no M3, áudio/vídeo no M4) é um
 * "produtor": chama {@link JobRegistryValue.registerJob} uma vez ao iniciar
 * e {@link JobRegistryValue.updateJobStatus} a cada transição de estado.
 * Regras do contrato:
 *
 * 1. `id` é escolhido pelo PRODUTOR, não pelo registro — deve ser único por
 *    EXECUÇÃO (ex.: `extract-${attachmentId}-${Date.now()}`), permitindo que
 *    tentativas repetidas do mesmo tipo de job apareçam como entradas
 *    distintas no painel (histórico da sessão, não um contador único por
 *    recurso). `registerJob` faz upsert por `id`: registrar de novo com um
 *    `id` já existente substitui a entrada em vez de duplicá-la.
 * 2. Transições de `status` esperadas: `pending` (enfileirado, ainda não
 *    iniciado) → `processing` (em execução) → `done` | `failed` (estado
 *    terminal). Produtores sem fase de fila (ex.: exportação, #33 — dispara
 *    e já começa a gravar) podem registrar direto em `processing`.
 * 3. `startedAt` (epoch ms, `Date.now()`) é OPCIONAL — quando presente, é o
 *    instante em que o job entrou em `processing` (não o momento do
 *    registro em si, que pode ser antes se o job nasceu `pending`). Hoje o
 *    painel (`./screens/jobs.tsx`) não renderiza duração a partir disso —
 *    campo já capturado para uma UI futura sem exigir novo campo no
 *    contrato.
 * 4. `cancelable`/`onCancel`: só produtores que sabem interromper a
 *    operação de fato devem marcar `cancelable: true` E fornecer
 *    `onCancel` (chamado pelo painel ao usuário pressionar Ctrl+C com o job
 *    selecionado). Exportação (#33) NÃO é cancelável — nada a abortar no
 *    meio de um `writeFile` — o painel mostra "(não cancelável)" para ela.
 *    A infraestrutura de cancelamento REAL (abortar uma extração em
 *    andamento) é do M4; até lá, nenhum produtor real marca `cancelable`.
 * 5. Jobs terminais (`done`/`failed`) permanecem no registro até o fim da
 *    sessão (histórico "concluídas da sessão" da AC) — nenhuma limpeza
 *    automática hoje.
 */
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

/** Estados possíveis de um job (ver a regra 2 do contrato no JSDoc do módulo). */
export type JobStatus = 'pending' | 'processing' | 'done' | 'failed';

/**
 * Um job da sessão, exibido no painel (`./screens/jobs.tsx`). Ver o JSDoc do
 * módulo para o contrato completo consumido por produtores futuros (M3/M4).
 */
export interface Job {
  /** Identificador único da EXECUÇÃO (não do recurso) — escolhido pelo produtor, ver regra 1. */
  id: string;
  /** Rótulo legível exibido no painel (ex.: `Exportar #88 (md)`). */
  label: string;
  /** Estado atual — ver as transições esperadas na regra 2. */
  status: JobStatus;
  /** Instante (epoch ms) em que o job entrou em `processing` — ver regra 3. Opcional. */
  startedAt?: number;
  /** `true` só quando o produtor também fornece {@link onCancel} — ver regra 4. Default `false`. */
  cancelable?: boolean;
  /** Chamado pelo painel ao usuário pressionar Ctrl+C com este job selecionado, quando `cancelable` é `true`. */
  onCancel?: () => void;
  /** Progresso incremental 0–100 (extrações M3/M4). Omitido: indeterminado. */
  progress?: number;
  /** Detalhe curto da fase atual ou mensagem de erro (ex.: "transcrevendo áudio"). */
  detail?: string;
}

/** Campos atualizáveis de um job em andamento — ver {@link JobRegistryValue.updateJob}. */
export interface JobPatch {
  status?: JobStatus;
  progress?: number;
  detail?: string;
  label?: string;
}

/** Teto de jobs retidos: além disso, os CONCLUÍDOS mais antigos são descartados (GC). */
const MAX_JOBS = 50;

/** Estados terminais — não aceitam transição de volta (ver validação no updateJob). */
const TERMINAL: readonly JobStatus[] = ['done', 'failed'];

/** Valor exposto pelo contexto do registro de jobs. */
export interface JobRegistryValue {
  /** Jobs da sessão, na ordem de registro (mais antigo primeiro). */
  jobs: readonly Job[];
  /**
   * Registra um job novo, ou substitui (upsert por `id`) um já existente —
   * ver regra 1 do contrato.
   */
  registerJob: (job: Job) => void;
  /**
   * Atualiza campos do job (`status`/`progress`/`detail`/`label`). Sem efeito
   * se `id` não existir. Transições a partir de estado TERMINAL (`done`/
   * `failed`) são ignoradas — bug de produtor não regride o painel.
   */
  updateJob: (id: string, patch: JobPatch) => void;
  /** Atalho de compatibilidade: `updateJob(id, { status })`. */
  updateJobStatus: (id: string, status: JobStatus) => void;
}

const JobRegistryContext = createContext<JobRegistryValue | undefined>(undefined);

/**
 * Provider do registro de jobs — instanciado uma vez em `./app.tsx`,
 * envolvendo toda a árvore de telas (ver o JSDoc do módulo).
 */
export function JobRegistryProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Job[]>([]);

  // Identidades ESTÁVEIS (useCallback sem deps, padrão do repo) — evita
  // resubscrições desnecessárias em quem as usa como dependência de efeito
  // (ex.: `./screens/export.tsx`).
  const registerJob = useCallback((job: Job) => {
    setJobs((current) => {
      const index = current.findIndex((existing) => existing.id === job.id);
      let next: Job[];
      if (index === -1) {
        next = [...current, job];
      } else {
        next = current.slice();
        next[index] = job;
      }
      // GC: acima do teto, descarta os CONCLUÍDOS mais antigos (em andamento
      // nunca são descartados) — sessões longas com muitas extrações (M3/M4)
      // não acumulam sem bound.
      if (next.length > MAX_JOBS) {
        const overflow = next.length - MAX_JOBS;
        let removed = 0;
        next = next.filter((j) => {
          if (removed < overflow && TERMINAL.includes(j.status)) {
            removed += 1;
            return false;
          }
          return true;
        });
      }
      return next;
    });
  }, []);

  const updateJob = useCallback((id: string, patch: JobPatch) => {
    setJobs((current) =>
      current.map((job) => {
        if (job.id !== id) return job;
        if (TERMINAL.includes(job.status) && patch.status !== undefined && patch.status !== job.status) {
          // Estado terminal não regride — ignora a transição inválida inteira.
          return job;
        }
        return { ...job, ...patch };
      }),
    );
  }, []);

  const updateJobStatus = useCallback((id: string, status: JobStatus) => {
    updateJob(id, { status });
  }, [updateJob]);

  const value: JobRegistryValue = { jobs, registerJob, updateJob, updateJobStatus };

  return <JobRegistryContext.Provider value={value}>{children}</JobRegistryContext.Provider>;
}

/**
 * Hook do registro de jobs, consumido tanto por produtores (`./screens/export.tsx`,
 * futuramente extração no M3/M4) quanto pelo painel (`./screens/jobs.tsx`).
 *
 * @throws {Error} Se chamado fora de um `<JobRegistryProvider>` — indica erro
 *   de composição (tela renderizada sem passar pelo roteador).
 */
export function useJobRegistry(): JobRegistryValue {
  const value = useContext(JobRegistryContext);
  if (value === undefined) {
    throw new Error('useJobRegistry() usado fora de <JobRegistryProvider>.');
  }
  return value;
}
