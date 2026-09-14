/**
 * Guarda de DIGITAÇÃO para os atalhos de letra.
 *
 * O Ink entrega cada tecla a TODOS os `useInput` registrados na árvore — um
 * campo de texto ativo não "consome" a tecla. Sem esta guarda, qualquer atalho
 * global de letra dispara no meio da digitação: `q` (sair) fecha a TUI enquanto
 * se digita a URL da instância no onboarding (`https://redmine.qualquer...`) ou
 * uma senha que contenha a letra.
 *
 * As telas que já sabem quando estão em modo de texto (a busca da home) checam
 * o próprio estado; este módulo cobre o caso GERAL — qualquer `TextInput` ativo
 * em qualquer tela suspende os atalhos de letra enquanto durar.
 *
 * Mesmo desenho de `./use-escape-interceptor.ts`: estado mutável em nível de
 * módulo, não Context/Provider — a TUI sustenta uma tela por vez e um Provider
 * seria complexidade sem benefício. Aqui é um CONTADOR (não um booleano) porque
 * uma tela pode montar mais de um campo (ex.: usuário + senha) e a ordem de
 * montagem/desmontagem entre eles não é garantida.
 *
 * Atalhos com modificador (`Ctrl+C`) continuam livres: eles não colidem com
 * texto. `Command+<letra>` não é alternativa em TUI — no macOS o terminal
 * intercepta antes de a tecla chegar à aplicação.
 */
import { useEffect } from 'react';

/** Quantidade de campos de texto ATIVOS no momento. */
let activeInputs = 0;

/**
 * Há algum campo de texto ativo agora?
 *
 * Chamado pelos handlers de atalho ANTES de reagir a uma tecla de letra.
 *
 * @returns `true` enquanto qualquer `TextInput` ativo estiver montado.
 */
export function isTyping(): boolean {
  return activeInputs > 0;
}

/** Zera o contador — para os testes não vazarem estado entre casos. */
export function resetTypingGuard(): void {
  activeInputs = 0;
}

/**
 * Registra um campo de texto como ativo enquanto `active` for `true`.
 *
 * @param active - `true` enquanto o campo captura teclado.
 * @example
 * // dentro de um componente de input:
 * useTypingGuard(isActive);
 */
export function useTypingGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    activeInputs += 1;
    return () => {
      activeInputs = Math.max(0, activeInputs - 1);
    };
  }, [active]);
}
