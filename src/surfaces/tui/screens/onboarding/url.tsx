/**
 * Tela de onboarding 1/3: URL da instância Redmine (M2-05.1, issue #27).
 *
 * Valida apenas o ESQUEMA da URL ao confirmar (Enter) — a validação real
 * (URL bem formada, instância alcançável) fica para a #28, que chama o core
 * via os callbacks injetáveis do `OnboardingContext`. `http://` só é aceito
 * quando `REDMINE_INSECURE` já está definida no ambiente do processo (`1`
 * ou `true`, case-insensitive — mesma convenção de `../../../mcp/server.ts`
 * e da flag `--insecure` da CLI) — e, mesmo aceito, dispara um aviso em
 * `theme.warning` porque o tráfego (incluindo a api_key futura) não é
 * criptografado.
 */
import { Box, Text } from 'ink';
import { useState } from 'react';

import { TextInput } from '../../components/text-input.js';
import { useNavigation } from '../../navigation.js';
import { symbols } from '../../symbols.js';
import { useTheme } from '../../theme.js';
import { useOnboarding } from './onboarding-context.js';

/** Resultado da classificação de uma URL digitada (ver {@link classifyUrl}). */
export type UrlClassification =
  | { kind: 'valid' }
  | { kind: 'insecure-allowed' }
  | { kind: 'insecure-blocked' }
  | { kind: 'invalid' };

/**
 * Interpreta `REDMINE_INSECURE` (`1`/`true`, case-insensitive) — mesma
 * convenção usada pelo MCP (`../../../mcp/server.ts`).
 */
function isInsecureEnvSet(env: NodeJS.ProcessEnv): boolean {
  const raw = env.REDMINE_INSECURE;
  return raw !== undefined && /^(1|true)$/i.test(raw.trim());
}

/**
 * Classifica a URL digitada pelo esquema (`https://`/`http://`) — parsing
 * completo da URL fica para a #28.
 *
 * @param value - Valor bruto do campo (ainda não `trim()`ado).
 * @param insecureEnvSet - `true` quando `REDMINE_INSECURE` está definida no
 *   ambiente (ver {@link isInsecureEnvSet}).
 * @example
 * classifyUrl('https://redmine.example', false); // { kind: 'valid' }
 * classifyUrl('http://redmine.example', false); // { kind: 'insecure-blocked' }
 */
export function classifyUrl(value: string, insecureEnvSet: boolean): UrlClassification {
  const trimmed = value.trim();
  if (trimmed.startsWith('https://') && trimmed.length > 'https://'.length) {
    return { kind: 'valid' };
  }
  if (trimmed.startsWith('http://') && trimmed.length > 'http://'.length) {
    return insecureEnvSet ? { kind: 'insecure-allowed' } : { kind: 'insecure-blocked' };
  }
  return { kind: 'invalid' };
}

/** Mensagem de feedback exibida abaixo do campo (aviso ou erro). */
interface Feedback {
  level: 'warning' | 'danger';
  message: string;
}

/** Tela de onboarding: URL — Enter confirma (avança para `onboarding-mode`), Esc volta (atalho global, ver `../../app.tsx`). */
export function OnboardingUrlScreen() {
  const { push } = useNavigation();
  const theme = useTheme();
  const { url, setUrl, callbacks } = useOnboarding();
  const [feedback, setFeedback] = useState<Feedback | undefined>(undefined);

  function handleSubmit(value: string) {
    const classification = classifyUrl(value, isInsecureEnvSet(process.env));
    const trimmed = value.trim();

    if (classification.kind === 'valid' || classification.kind === 'insecure-allowed') {
      setFeedback(
        classification.kind === 'insecure-allowed'
          ? {
              level: 'warning',
              message:
                'AVISO: conexão insegura (http://) habilitada via REDMINE_INSECURE — o tráfego não é criptografado.',
            }
          : undefined,
      );
      setUrl(trimmed);
      callbacks.onUrlSubmit(trimmed);
      push('onboarding-mode');
      return;
    }

    if (classification.kind === 'insecure-blocked') {
      setFeedback({
        level: 'danger',
        message:
          'Conexão http:// recusada: TLS é obrigatório. Use https:// ou defina REDMINE_INSECURE (não recomendado) para permitir.',
      });
      return;
    }

    setFeedback({
      level: 'danger',
      message: 'Informe uma URL começando com https:// (ex.: https://redmine.example).',
    });
  }

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} borderStyle="round" borderColor={theme.border}>
      <Text color={theme.primary}>
        URL do Redmine
      </Text>
      <Box marginTop={1}>
        <Text color={theme.muted}>{symbols.pointer} </Text>
        <TextInput value={url} onChange={setUrl} onSubmit={handleSubmit} placeholder="https://redmine.example" />
      </Box>
      {feedback !== undefined ? (
        <Box marginTop={1}>
          <Text color={feedback.level === 'danger' ? theme.danger : theme.warning}>
            {feedback.level === 'danger' ? symbols.cross : symbols.warning} {feedback.message}
          </Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color={theme.muted}>
          Pressione{' '}
          <Text color={theme.accent}>
            Enter
          </Text>{' '}
          para confirmar,{' '}
          <Text color={theme.accent}>
            Esc
          </Text>{' '}
          para voltar.
        </Text>
      </Box>
    </Box>
  );
}
