/**
 * Issue em memória compartilhada entre `./issue-detail.tsx` e `./export.tsx`
 * (#33), mesmo padrão de `./home-selection.tsx` (contexto leve, instanciado
 * uma vez em `../app.tsx`, sobrevivendo ao unmount de cada tela).
 *
 * ## Por que este contexto existe (escolha de reuso documentada, AC da #33)
 *
 * A tela de exportação precisa da MESMA {@link Issue} já carregada pelo
 * detalhe para empacotar via `buildMarkdownBundle`/`buildJsonBundle`
 * (`../../../index.js`). Duas opções foram consideradas:
 *
 * 1. **Reusar a issue em memória** (escolhida): `./issue-detail.tsx` grava a
 *    issue aqui assim que `useIssueDetail` resolve para `loaded`; `./export.tsx`
 *    lê daqui e chama os builders DIRETO — sem HTTP nem normalização de novo.
 * 2. **Refetch simples**: `./export.tsx` chamaria `fetchIssueBundle` (ou o
 *    par `getIssue`+`normalizeIssue`) de novo, ignorando que o detalhe acabou
 *    de buscar a mesma issue segundos antes.
 *
 * (1) evita uma segunda chamada de rede redundante (a issue não muda entre o
 * usuário abrir o detalhe e pressionar `e`) e é consistente com a decisão já
 * tomada pela #31 de manter o modelo `Issue` em memória em vez de só um bundle
 * serializado. O roteador (`../app.tsx`) só mantém montado o TOPO da pilha —
 * ao empilhar `export` a partir do detalhe, `IssueDetailScreen` é desmontada,
 * então a issue precisa sobreviver em algo ACIMA da pilha, daí o contexto
 * (mesmo raciocínio do `HomeSelectionProvider`, ver o JSDoc daquele módulo).
 */
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

import type { Issue } from '../../../index.js';

/** Valor exposto pelo contexto da issue em memória. */
export interface LoadedIssueValue {
  /** Última issue carregada por `./issue-detail.tsx`, ou `undefined` antes de qualquer carga. */
  issue: Issue | undefined;
  /** Registra a issue carregada — chamado pelo detalhe assim que `useIssueDetail` resolve para `loaded`. */
  setIssue: (issue: Issue) => void;
}

const LoadedIssueContext = createContext<LoadedIssueValue | undefined>(undefined);

/**
 * Provider do contexto de issue em memória — instanciado uma vez em
 * `../app.tsx`, envolvendo toda a árvore de telas (ver o JSDoc do módulo).
 */
export function LoadedIssueProvider({ children }: { children: ReactNode }) {
  const [issue, setIssueState] = useState<Issue | undefined>(undefined);

  // Identidade ESTÁVEL (useCallback sem deps, padrão do repo) — evita
  // resubscrições desnecessárias em quem a usa como dependência de efeito
  // (ex.: `./issue-detail.tsx`).
  const setIssue = useCallback((next: Issue) => {
    setIssueState(next);
  }, []);

  const value: LoadedIssueValue = { issue, setIssue };

  return <LoadedIssueContext.Provider value={value}>{children}</LoadedIssueContext.Provider>;
}

/**
 * Hook de issue em memória consumido por `./issue-detail.tsx`/`./export.tsx`.
 *
 * @throws {Error} Se chamado fora de um `<LoadedIssueProvider>` — indica erro
 *   de composição (tela renderizada sem passar pelo roteador).
 */
export function useLoadedIssue(): LoadedIssueValue {
  const value = useContext(LoadedIssueContext);
  if (value === undefined) {
    throw new Error('useLoadedIssue() usado fora de <LoadedIssueProvider>.');
  }
  return value;
}
