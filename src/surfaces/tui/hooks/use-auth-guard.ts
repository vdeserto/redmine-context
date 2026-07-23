/**
 * Guarda central de re-autenticação (M2-13, issue #36).
 *
 * QUALQUER tela de dados (#29+) que chame o core autenticado deve envolver
 * essa chamada com `guard()`. Se a operação rejeitar com `RedmineAuthError`
 * (401 — a api_key expirou ou foi revogada no servidor), o guard:
 *
 * 1. guarda a tela ATUAL (`useNavigation().current`) como origem e a própria
 *    chamada como callback de retry;
 * 2. empurra `onboarding-login` em modo re-auth
 *    (`OnboardingContext.beginReAuth`, `../screens/onboarding/onboarding-context.tsx`),
 *    reaproveitando o fluxo de onboarding já existente para o usuário logar
 *    de novo — sem repetir `onboarding-url`/`onboarding-mode`, já que a
 *    instância já é conhecida;
 * 3. quando o re-login resolve com sucesso, `validating.tsx`/`api-key.tsx`
 *    (`../screens/onboarding/`) chamam `OnboardingContext.resolveReAuth()`,
 *    que dispara o `retry` guardado aqui — SÓ NESSE MOMENTO a `Promise`
 *    devolvida por `guard()` resolve, com o resultado da nova tentativa — e a
 *    navegação volta à tela de origem (`useNavigation().popTo`, chamado pelas
 *    mesmas telas antes de `resolveReAuth()`).
 *
 * Se o re-login falhar (senha errada, rede fora do ar), a tela de login
 * segue seu fluxo normal (mensagem de erro, tentar de novo) — o `reAuth`
 * guardado no contexto permanece intacto (a origem não se perde) até uma
 * tentativa ter sucesso.
 *
 * A credencial antiga é sobrescrita normalmente pela cascata de persistência
 * (`createCredentialCascade().set()`, já chamada por
 * `./use-onboarding-callbacks.ts` em todo login bem-sucedido, re-auth ou não)
 * — nenhum tratamento especial é necessário aqui.
 *
 * Fix do review do PR #119 — dois problemas cobertos aqui:
 *
 * 1. Abandono do re-login (Esc): antes, a `Promise` de `guard()` ficava
 *    pendurada para sempre se o usuário apertasse Esc na tela de login em
 *    vez de completar o re-auth. Agora o atalho global de Esc
 *    (`../../app.tsx`), ao detectar que está numa tela `onboarding-*` com um
 *    `reAuth` ativo, chama `OnboardingContext.abortReAuth()` — que rejeita
 *    a `Promise` com {@link ReAuthAbortedError}. Chamadoras de `guard()`
 *    (telas de dados) devem tratar essa rejeição como uma operação
 *    CANCELADA (estado neutro — "usuário desistiu de logar de novo"), não
 *    como uma falha a ser exibida como erro/crash.
 * 2. 401 concorrentes: antes, um segundo `guard()` falhando com 401 enquanto
 *    o primeiro já tinha iniciado o re-auth SOBRESCREVIA o `reAuth` no
 *    contexto — o primeiro retry/reject ficava órfão. Agora
 *    `OnboardingContext.beginReAuth()` acumula uma lista de pendências; uma
 *    única passagem de login bem-sucedida (`resolveReAuth()`) resolve TODOS
 *    os `guard()` pendentes.
 *
 * @example
 * // Tela de dados futura (#29+, ex.: `screens/home.tsx`):
 * import { useAuthGuard } from '../hooks/use-auth-guard.js';
 *
 * function HomeScreen() {
 *   const { guard } = useAuthGuard();
 *   const [bundle, setBundle] = useState<IssueBundleResult>();
 *
 *   useEffect(() => {
 *     let cancelled = false;
 *     guard(() => fetchIssueBundleViaCore(issueId)).then((result) => {
 *       if (!cancelled) setBundle(result);
 *     });
 *     return () => {
 *       cancelled = true;
 *     };
 *   }, [issueId]);
 *   // ...
 * }
 */
import { useCallback, useRef } from 'react';

import { RedmineAuthError } from '../../../index.js';
import { useNavigation } from '../navigation.js';
import type { ScreenName } from '../screen.js';
import { useOnboarding } from '../screens/onboarding/onboarding-context.js';

/**
 * Erro de rejeição de `guard()` quando o re-login em andamento é ABANDONADO
 * (Esc na tela de onboarding, ver `../app.tsx`) em vez de concluído — fix do
 * review do PR #119.
 *
 * @remarks Telas de dados que chamam `guard()` devem tratar esta rejeição
 *   como uma operação CANCELADA pelo usuário (volte a um estado neutro —
 *   ex.: `status: 'idle'` — igual a antes da chamada), e não como uma falha
 *   inesperada (nada de mensagem de erro em vermelho ou crash): o usuário
 *   escolheu conscientemente não reautenticar.
 */
export class ReAuthAbortedError extends Error {
  constructor(message = 'Re-autenticação cancelada pelo usuário (Esc).') {
    super(message);
    this.name = 'ReAuthAbortedError';
  }
}

/** Valor retornado por {@link useAuthGuard}. */
export interface UseAuthGuardResult {
  /**
   * Envolve uma operação autenticada do core.
   *
   * Devolve o mesmo resultado (ou rejeição) da operação em condições normais.
   * Em caso de `RedmineAuthError`, dispara o fluxo de re-auth descrito no
   * módulo e só resolve depois que o usuário loga de novo e a operação é
   * reexecutada — chamadoras que precisam de um `AbortController`/cleanup
   * (ex.: `useEffect`) continuam funcionando normalmente: a promise
   * devolvida é só ignorada se o componente desmontar antes dela resolver.
   *
   * Se o re-login for abandonado (Esc, ver `../app.tsx`), a `Promise`
   * rejeita com {@link ReAuthAbortedError} — trate como cancelamento, não
   * como erro (ver o remark da classe).
   *
   * @param operation - A chamada ao core a proteger (ex.: `fetchIssueBundle`).
   */
  guard<T>(operation: () => Promise<T>): Promise<T>;
}

/**
 * Hook público de re-autenticação — ver o JSDoc do módulo para o contrato
 * completo.
 */
export function useAuthGuard(): UseAuthGuardResult {
  const { current, push } = useNavigation();
  const { beginReAuth } = useOnboarding();

  // Refs (não deps do useCallback): `guard` precisa ficar com identidade
  // ESTÁVEL (padrão do repo) mesmo com `current`/`push`/`beginReAuth` mudando
  // entre renders — o valor lido é sempre o mais recente via ref.
  const currentRef = useRef(current);
  currentRef.current = current;
  const pushRef = useRef(push);
  pushRef.current = push;
  const beginReAuthRef = useRef(beginReAuth);
  beginReAuthRef.current = beginReAuth;

  const guard = useCallback(function guardOperation<T>(
    operation: () => Promise<T>,
    // A origem é capturada UMA VEZ, na primeira falha — e reaproveitada em
    // retries subsequentes (`falha do re-login não perde a origem`, DoD
    // #36), mesmo que a navegação já tenha mudado quando o retry acontece.
    origin: ScreenName = currentRef.current,
  ): Promise<T> {
    return operation().catch((cause: unknown) => {
      if (!(cause instanceof RedmineAuthError)) {
        throw cause;
      }
      return new Promise<T>((resolve, reject) => {
        // Fix do review #119: `beginReAuth` devolve `true` só na PRIMEIRA
        // vez que este ciclo de re-auth é ativado — 401 concorrentes
        // (segunda chamada enquanto a primeira já empilhou o login) só
        // adicionam a pendência à lista existente, sem empilhar
        // `onboarding-login` de novo nem perder o retry/reject anterior.
        const activated = beginReAuthRef.current(origin, {
          retry: () => {
            guardOperation(operation, origin).then(resolve, reject);
          },
          reject,
        });
        if (activated) {
          pushRef.current('onboarding-login');
        }
      });
    });
  }, []);

  return { guard };
}
