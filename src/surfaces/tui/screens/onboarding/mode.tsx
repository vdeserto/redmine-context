/**
 * Tela de onboarding 2/3: modo de autenticação (M2-05.1, issue #27).
 *
 * Seleção entre login por usuário/senha (avança para `onboarding-login`) e
 * colar uma api_key diretamente (avança para `onboarding-api-key`, #28).
 * `useListNavigation` (M2-04) dá o teclado padrão de lista (setas/`j`/`k`/
 * Enter) de graça — nenhuma reimplementação aqui.
 */
import { Box, Text } from 'ink';

import { glyphs } from '../../glyphs.js';
import { useListNavigation } from '../../hooks/use-list-navigation.js';
import { useNavigation } from '../../navigation.js';
import { symbols } from '../../symbols.js';
import { useTheme } from '../../theme.js';
import { type OnboardingMode, useOnboarding } from './onboarding-context.js';

/** Uma opção selecionável da tela de modo. */
interface ModeOption {
  mode: OnboardingMode;
  label: string;
}

/** As duas formas de autenticação suportadas pelo onboarding. */
const MODE_OPTIONS: readonly ModeOption[] = [
  { mode: 'password', label: 'Entrar com usuário e senha' },
  { mode: 'api-key', label: 'Colar uma api_key' },
];

/** Tela de onboarding: modo de autenticação — setas/`j`/`k` navegam, Enter confirma, Esc volta (atalho global, ver `../../app.tsx`). */
export function OnboardingModeScreen() {
  const { push } = useNavigation();
  const theme = useTheme();
  const { setMode, callbacks } = useOnboarding();

  const { selectedIndex } = useListNavigation(MODE_OPTIONS.length, {
    onSelect: (index) => {
      const option = MODE_OPTIONS[index];
      if (option === undefined) {
        return;
      }
      setMode(option.mode);
      callbacks.onModeSelect(option.mode);
      push(option.mode === 'password' ? 'onboarding-login' : 'onboarding-api-key');
    },
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} borderStyle="round" borderColor={theme.border}>
      <Text color={theme.primary}>
        Como você quer entrar?
      </Text>
      <Box marginTop={1} flexDirection="column">
        {MODE_OPTIONS.map((option, index) => {
          const isSelected = index === selectedIndex;
          return (
            <Text key={option.mode} color={isSelected ? theme.primary : theme.muted}>
              {isSelected ? symbols.pointer : ' '} {option.label}
            </Text>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.muted}>
          <Text color={theme.accent}>
            {`${glyphs.arrowUp}${glyphs.arrowDown}/j/k`}
          </Text>{' '}
          navegam,{' '}
          <Text color={theme.accent}>
            Enter
          </Text>{' '}
          confirma,{' '}
          <Text color={theme.accent}>
            Esc
          </Text>{' '}
          volta.
        </Text>
      </Box>
    </Box>
  );
}
