/**
 * Breadcrumb fixo da TUI (M2-04) — reflete a PILHA de telas do roteador
 * (`../navigation.tsx`) como "Início › Atalhos". Primeiro componente
 * compartilhado da TUI (`components/`): puramente apresentacional — recebe
 * a pilha via prop em vez de ler o contexto de navegação diretamente, para
 * poder ser testado isolado (sem `NavigationProvider`, só `ThemeProvider`).
 *
 * Estética: tela atual em `primary` (negrito), telas anteriores em `muted`,
 * separadas pelo símbolo de navegação de `../symbols.ts` (nunca hardcoded);
 * uma borda inferior discreta em `theme.border` fecha a barra sem competir
 * com o conteúdo da tela abaixo.
 */
import { Box, Text } from 'ink';
import type { ReactNode } from 'react';

import { SCREENS, type ScreenName } from '../screen.js';
import { symbols } from '../symbols.js';
import { useTheme } from '../theme.js';

export interface BreadcrumbProps {
  /** Pilha de telas navegadas (base -> topo) — o topo é a tela atual. */
  stack: readonly ScreenName[];
}

/** Breadcrumb fixo no topo do app: título da tela atual em destaque, caminho anterior discreto. */
export function Breadcrumb({ stack }: BreadcrumbProps) {
  const theme = useTheme();
  const lastIndex = stack.length - 1;
  const segments: ReactNode[] = [];

  stack.forEach((name, index) => {
    const isCurrent = index === lastIndex;

    if (index > 0) {
      segments.push(
        <Text key={`separator-${index}`} color={theme.muted}>
          {' '}
          {symbols.pointerSmall}{' '}
        </Text>,
      );
    }

    segments.push(
      <Text key={`title-${index}`} bold={isCurrent} color={isCurrent ? theme.primary : theme.muted}>
        {SCREENS[name].title}
      </Text>,
    );
  });

  return (
    <Box
      paddingX={1}
      marginBottom={1}
      borderStyle="single"
      borderTop={false}
      borderLeft={false}
      borderRight={false}
      borderBottomColor={theme.border}
    >
      {segments}
    </Box>
  );
}
