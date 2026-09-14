import { describe, expect, it } from 'vitest';

import { listWindow } from '../../../src/surfaces/tui/list-window.js';

describe('listWindow', () => {
  // Caso esperado: lista que cabe inteira não é fatiada.
  it('mostra tudo quando cabe na altura', () => {
    expect(listWindow(5, 0, 20)).toEqual({ start: 0, end: 5 });
    expect(listWindow(20, 19, 20)).toEqual({ start: 0, end: 20 });
  });

  // O caso que originou a correção: 288 issues fechadas, cursor no topo.
  it('gruda no início quando o cursor está nas primeiras posições', () => {
    expect(listWindow(288, 0, 28)).toEqual({ start: 0, end: 28 });
    expect(listWindow(288, 5, 28)).toEqual({ start: 0, end: 28 });
  });

  it('centraliza o cursor no meio da lista', () => {
    expect(listWindow(288, 100, 20)).toEqual({ start: 90, end: 110 });
  });

  // Nas pontas a janela gruda, senão sobraria espaço vazio no fim da tela.
  it('gruda no fim quando o cursor está nas últimas posições', () => {
    expect(listWindow(288, 287, 28)).toEqual({ start: 260, end: 288 });
    expect(listWindow(288, 280, 28)).toEqual({ start: 260, end: 288 });
  });

  // A invariante que importa: o cursor NUNCA sai da janela — foi o sintoma
  // relatado ("cadê meu cursor").
  it('mantém o cursor dentro da janela em qualquer posição', () => {
    const total = 347;
    const height = 25;
    for (let selected = 0; selected < total; selected += 1) {
      const { start, end } = listWindow(total, selected, height);
      expect(selected).toBeGreaterThanOrEqual(start);
      expect(selected).toBeLessThan(end);
      expect(end - start).toBe(height);
    }
  });

  // Failure case: entradas degeneradas não podem gerar slice inválido.
  it.each([
    [0, 0, 20],
    [10, 0, 0],
    [10, 0, -5],
  ])('devolve janela vazia para total=%i selected=%i height=%i', (total, selected, height) => {
    expect(listWindow(total, selected, height)).toEqual({ start: 0, end: 0 });
  });

  // Edge case: índice fora da faixa (lista encolheu entre renders, ao trocar de
  // filtro) é fixado — sem isso o slice sairia deslocado.
  it('fixa índice fora da faixa', () => {
    expect(listWindow(50, 999, 10)).toEqual({ start: 40, end: 50 });
    expect(listWindow(50, -5, 10)).toEqual({ start: 0, end: 10 });
  });
});
