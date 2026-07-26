/**
 * Testes de `job-registry.tsx` (#34/M2-11) — registro leve de jobs da
 * sessão, mesmo padrão unitário de `screens/home-selection.test.tsx`/
 * `screens/loaded-issue-context.test.tsx`. Escrito ANTES da implementação
 * (TDD): estado inicial, registro/transição de status (a AC "registro/
 * transição de estados" do DoD), `useJobRegistry()` fora do provider, e
 * isolamento entre árvores de teste (sem singleton de módulo).
 */
import { Text, useInput } from 'ink';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';

import {
  JobRegistryProvider,
  useJobRegistry,
  type Job,
  type JobStatus,
} from '../../../src/surfaces/tui/job-registry.js';
import { Catch } from './catch-boundary.js';

/** Sonda que expõe `jobs` como texto plano, uma linha por job (`id:status`). */
function Probe() {
  const { jobs } = useJobRegistry();
  return <Text>{jobs.map((job) => `${job.id}:${job.status}`).join(',') || '(vazio)'}</Text>;
}

const JOB_A: Job = { id: 'job-a', label: 'Job A', status: 'pending' };
const JOB_B: Job = { id: 'job-b', label: 'Job B', status: 'processing', startedAt: 1000 };

describe('TUI: useJobRegistry — unitário', () => {
  it('lança fora de <JobRegistryProvider> (mesmo padrão de useNavigation()/useHomeSelection())', () => {
    function Bare() {
      useJobRegistry();
      return null;
    }
    // Reason (mesma observação de home-selection.test.tsx): Ink tem seu
    // próprio error boundary interno — o erro aparece no frame, não escapa
    // como exceção síncrona de `render()`.
    const { lastFrame } = render(
      <Catch>
        <Bare />
      </Catch>,
    );
    expect(lastFrame()).toContain('useJobRegistry() usado fora de <JobRegistryProvider>.');
  });

  it('começa com jobs vazio', () => {
    const { lastFrame } = render(
      <JobRegistryProvider>
        <Probe />
      </JobRegistryProvider>,
    );
    expect(lastFrame()).toBe('(vazio)');
  });

  it('registerJob adiciona um job novo, preservando a ordem de registro', async () => {
    function Registrar() {
      const { registerJob } = useJobRegistry();
      useInput(() => {
        registerJob(JOB_A);
        registerJob(JOB_B);
      });
      return <Probe />;
    }
    const { lastFrame, stdin } = render(
      <JobRegistryProvider>
        <Registrar />
      </JobRegistryProvider>,
    );
    stdin.write('x');
    await vi.waitFor(() => {
      expect(lastFrame()).toBe('job-a:pending,job-b:processing');
    });
  });

  it('registerJob com um "id" já existente substitui a entrada (upsert), sem duplicar', async () => {
    function Registrar() {
      const { registerJob } = useJobRegistry();
      useInput((input) => {
        if (input === '1') registerJob(JOB_A);
        if (input === '2') registerJob({ ...JOB_A, status: 'processing' });
      });
      return <Probe />;
    }
    const { lastFrame, stdin } = render(
      <JobRegistryProvider>
        <Registrar />
      </JobRegistryProvider>,
    );
    stdin.write('1');
    await vi.waitFor(() => expect(lastFrame()).toBe('job-a:pending'));

    stdin.write('2');
    await vi.waitFor(() => expect(lastFrame()).toBe('job-a:processing'));
  });

  it('updateJobStatus transiciona o status de um job específico, sem afetar os demais', async () => {
    function Updater() {
      const { registerJob, updateJobStatus } = useJobRegistry();
      useInput((input) => {
        if (input === '1') {
          registerJob(JOB_A);
          registerJob(JOB_B);
        }
        if (input === '2') updateJobStatus('job-a', 'done' satisfies JobStatus);
      });
      return <Probe />;
    }
    const { lastFrame, stdin } = render(
      <JobRegistryProvider>
        <Updater />
      </JobRegistryProvider>,
    );
    stdin.write('1');
    await vi.waitFor(() => expect(lastFrame()).toBe('job-a:pending,job-b:processing'));

    stdin.write('2');
    await vi.waitFor(() => expect(lastFrame()).toBe('job-a:done,job-b:processing'));
  });

  it('updateJobStatus com um "id" desconhecido não lança e não altera nada', async () => {
    function Updater() {
      const { registerJob, updateJobStatus } = useJobRegistry();
      useInput((input) => {
        if (input === '1') registerJob(JOB_A);
        if (input === '2') updateJobStatus('job-inexistente', 'failed');
      });
      return <Probe />;
    }
    const { lastFrame, stdin } = render(
      <JobRegistryProvider>
        <Updater />
      </JobRegistryProvider>,
    );
    stdin.write('1');
    await vi.waitFor(() => expect(lastFrame()).toBe('job-a:pending'));

    expect(() => stdin.write('2')).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    expect(lastFrame()).toBe('job-a:pending');
  });

  it('cada render() de teste isola seu próprio provider (sem estado global vazando entre testes)', () => {
    // Reason: prova de que `JobRegistryProvider` é um `Context` local por
    // árvore (não um singleton de módulo) — os jobs registrados nos testes
    // ANTERIORES não vazam para uma árvore nova.
    const { lastFrame } = render(
      <JobRegistryProvider>
        <Probe />
      </JobRegistryProvider>,
    );
    expect(lastFrame()).toBe('(vazio)');
  });
});


describe('fixes do review #125: GC, patch e transições', () => {
  it('estado terminal não regride (done → pending ignorado por inteiro)', async () => {
    function Harness() {
      const { registerJob, updateJob } = useJobRegistry();
      useInput((input) => {
        if (input === '1') registerJob({ id: 'j1', label: 'x', status: 'done' });
        if (input === '2') updateJob('j1', { status: 'pending', detail: 'oops' });
      });
      return <Probe />;
    }
    const { lastFrame, stdin } = render(
      <JobRegistryProvider>
        <Harness />
      </JobRegistryProvider>,
    );
    stdin.write('1');
    await vi.waitFor(() => expect(lastFrame()).toBe('j1:done'));
    stdin.write('2');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(lastFrame()).toBe('j1:done');
  });

  it('updateJob atualiza progress/detail de job em andamento', async () => {
    function Harness() {
      const { registerJob, updateJob, jobs } = useJobRegistry();
      useInput((input) => {
        if (input === '1') registerJob({ id: 'j1', label: 'x', status: 'processing' });
        if (input === '2') updateJob('j1', { progress: 40, detail: 'transcrevendo áudio' });
      });
      const j = jobs[0];
      return <Text>{j ? `${j.id}:${j.status}:${j.progress ?? '-'}:${j.detail ?? '-'}` : '(vazio)'}</Text>;
    }
    const { lastFrame, stdin } = render(
      <JobRegistryProvider>
        <Harness />
      </JobRegistryProvider>,
    );
    stdin.write('1');
    await vi.waitFor(() => expect(lastFrame()).toBe('j1:processing:-:-'));
    stdin.write('2');
    await vi.waitFor(() => expect(lastFrame()).toBe('j1:processing:40:transcrevendo áudio'));
  });

  it('GC: acima de 50, concluídos mais antigos saem; em andamento ficam', async () => {
    function Harness() {
      const { registerJob, jobs } = useJobRegistry();
      useInput(() => {
        registerJob({ id: 'ativo', label: 'a', status: 'processing' });
        for (let i = 0; i < 55; i += 1) {
          registerJob({ id: `done-${i}`, label: `d${i}`, status: 'done' });
        }
      });
      return (
        <Text>
          {String(jobs.length)}|{jobs.some((j) => j.id === 'ativo') ? 'ativo-ok' : 'ativo-caiu'}|
          {jobs.some((j) => j.id === 'done-0') ? 'd0-vivo' : 'd0-gc'}
        </Text>
      );
    }
    const { lastFrame, stdin } = render(
      <JobRegistryProvider>
        <Harness />
      </JobRegistryProvider>,
    );
    stdin.write('x');
    await vi.waitFor(() => {
      const frame = lastFrame() ?? '';
      expect(frame).toContain('ativo-ok');
      expect(frame).toContain('d0-gc');
      const count = Number(frame.split('|')[0]);
      expect(count).toBeLessThanOrEqual(50);
    });
  });
});
