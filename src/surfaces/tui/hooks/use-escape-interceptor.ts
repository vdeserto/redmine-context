/**
 * Interceptação pontual do Esc global (M2-07, issue #30).
 *
 * O roteador (`../app.tsx`) trata `Esc` globalmente como `pop()` da pilha de
 * navegação (volta para a tela anterior). A busca inline da home
 * (`../screens/home.tsx`) precisa que `Esc`, enquanto o campo de busca está
 * ativo, feche a busca e restaure a lista original — em vez de desempilhar a
 * home e voltar para a tela de onde ela veio. Sem esse desvio, o usuário
 * sairia da home sem querer só por tentar limpar o texto da busca.
 *
 * Implementado como uma única referência mutável em nível de módulo, não um
 * Context/Provider: a TUI só sustenta UMA tela ativa por vez (arquitetura de
 * pilha, `../navigation.tsx`), então nunca há mais de um interceptor
 * concorrente de fato — um Provider/Context inteiro seria complexidade sem
 * benefício para esse caso. O mecanismo é genérico o bastante para qualquer
 * tela futura que precise do mesmo desvio pontual do Esc global.
 */
import { useEffect, useRef } from 'react';

/** Interceptor ativo no momento, ou `undefined` se nenhuma tela registrou um. */
let activeInterceptor: (() => void) | undefined;

/**
 * Consome o interceptor ativo, se houver — chamado pelo roteador (`../app.tsx`)
 * ANTES de aplicar o `pop()` padrão do Esc global.
 *
 * @returns `true` se um interceptor tratou o Esc (o chamador não deve fazer
 *   `pop()` nesse caso); `false` se nenhum interceptor está registrado (o
 *   chamador segue com o comportamento padrão).
 */
export function consumeEscapeInterceptor(): boolean {
  if (activeInterceptor === undefined) {
    return false;
  }
  activeInterceptor();
  return true;
}

/** Somente para testes: garante um estado limpo entre casos de teste. */
export function resetEscapeInterceptor(): void {
  activeInterceptor = undefined;
}

/**
 * Registra `onEscape` como o interceptor ativo enquanto `active` for `true`;
 * desregistra automaticamente quando `active` vira `false` ou o componente
 * desmonta (limpeza do `useEffect`).
 *
 * @param active - Só registra o interceptor enquanto `true` (ex.: campo de
 *   busca da home aberto).
 * @param onEscape - Chamado quando `Esc` é pressionado e este interceptor
 *   está ativo. Identidade pode mudar entre renders (lido via `ref`).
 *
 * @example
 * useEscapeInterceptor(isSearching, closeSearch);
 */
export function useEscapeInterceptor(active: boolean, onEscape: () => void): void {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!active) {
      return;
    }
    activeInterceptor = () => onEscapeRef.current();
    return () => {
      activeInterceptor = undefined;
    };
  }, [active]);
}
