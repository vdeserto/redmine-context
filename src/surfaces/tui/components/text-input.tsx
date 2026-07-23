/**
 * Input de texto de linha única, Ink puro (M2-05.1, issue #27) — sem
 * depender do `@inkjs/ui` ainda (ver `../theme.tsx`, mapeamento previsto
 * para quando a primeira tela adotar a lib). Cobre o necessário para as
 * telas de onboarding: eco normal (URL, usuário) e eco mascarado (senha,
 * `mask="•"`) — com `mask` definido, o valor real NUNCA é ecoado na tela,
 * só o caractere de máscara repetido pelo comprimento do valor.
 *
 * Suporta apenas edição no fim da string (sem mover o cursor pelo meio) —
 * suficiente para os campos de onboarding (URL, usuário, senha); um cursor
 * navegável fica para quando alguma tela precisar editar no meio do texto.
 *
 * `isActive` (default `true`) desliga a captura de teclado deste input
 * específico — necessário quando mais de um campo divide a mesma tela (ex.:
 * `../screens/onboarding/login.tsx`, usuário + senha): o `useInput()` do
 * Ink não tem noção de foco, então cada `TextInput` "inativo" precisa
 * ignorar o teclado, senão a mesma tecla digitaria nos dois campos ao mesmo
 * tempo.
 *
 * `maxWidth` (M2-16, #39, opcional) trunca o TEXTO EXIBIDO (nunca o `value`
 * de verdade, que segue completo para `onChange`/`onSubmit`) quando este
 * campo divide uma linha com outro elemento (ex.: um rótulo, ver
 * `../screens/export.tsx`) — sem isso, um valor comprido (ex.: um caminho de
 * destino) sobrepõe o rótulo vizinho (o Ink não reflui `<Text>` IRMÃS dentro
 * de um `<Box>` em linha; ver o JSDoc de `../truncate.ts`). O corte é a
 * partir do INÍCIO (`truncateStart`) — o usuário digita/edita no FIM da
 * string (ver o JSDoc do módulo acima), então é o fim que precisa continuar
 * visível.
 */
import { useCallback, useRef } from 'react';
import { Text, useInput } from 'ink';

import { useTheme } from '../theme.js';
import { truncate, truncateStart } from '../truncate.js';

/** Props do `TextInput` — ver guideline de uso na documentação do arquivo. */
export interface TextInputProps {
  /** Valor atual — controlado pelo componente pai (ex.: `useOnboarding().url`). */
  value: string;
  /** Chamado a cada tecla que altera o valor (digitação, backspace/delete). */
  onChange: (value: string) => void;
  /** Chamado quando o usuário confirma com Enter. Opcional. */
  onSubmit?: (value: string) => void;
  /**
   * Caractere de máscara — quando definido, o valor real NUNCA é
   * renderizado; a tela mostra `mask` repetido pelo comprimento do valor.
   * Omitido: eco normal (comportamento padrão).
   */
  mask?: string;
  /** Texto exibido (em `theme.muted`) quando `value` está vazio. */
  placeholder?: string;
  /** Captura teclado quando `true` (default). Ver guideline de foco acima. */
  isActive?: boolean;
  /**
   * Caracteres reservados por uma tecla de CONTROLE da tela pai (ex.: `f`
   * cicla o filtro de status na busca da home, M2-07/#30) — quando o `input`
   * recebido for EXATAMENTE um desses (tecla única, não uma sequência
   * colada com mais de um caractere), o `TextInput` ignora e NÃO chama
   * `onChange`. A tela pai continua recebendo o mesmo evento normalmente
   * (Ink despacha para todos os `useInput()` registrados, não só este) e
   * decide o que fazer com ele — este campo só evita que a tecla de controle
   * também vire texto digitado. Default: nenhum caractere reservado.
   */
  reservedChars?: readonly string[];
  /**
   * Largura máxima (colunas) do texto EXIBIDO — trunca `value`/`placeholder`
   * quando excedida (ver o JSDoc do módulo). Omitido: sem truncamento (uso
   * padrão, campo sozinho na própria linha).
   */
  maxWidth?: number;
}

/**
 * Input de texto de linha única com eco normal ou mascarado.
 *
 * @example
 * <TextInput value={url} onChange={setUrl} onSubmit={handleSubmit} placeholder="https://redmine.example" />
 * @example
 * <TextInput value={password} onChange={setPassword} mask="•" isActive={field === 'password'} />
 */
export function TextInput({
  value,
  onChange,
  onSubmit,
  mask,
  placeholder,
  isActive = true,
  reservedChars = [],
  maxWidth,
}: TextInputProps) {
  const theme = useTheme();

  // O handler do useInput pode disparar antes do resubscribe pós-commit do
  // Ink (ex.: colar "url\n" entrega texto e Enter no mesmo lote) — closures
  // capturariam o value da renderização anterior e o submit sairia vazio.
  // Refs sempre apontam para a versão corrente.
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const reservedCharsRef = useRef(reservedChars);
  reservedCharsRef.current = reservedChars;

  // Handler ESTÁVEL (useCallback + refs): identidade nova a cada render faz o
  // useInput des/re-subscrever no efeito pós-commit, abrindo janelas sem
  // listener onde teclas rápidas (ou lote colado) se perdem.
  const handleInput = useCallback((input: string, key: Parameters<Parameters<typeof useInput>[0]>[1]) => {
      if (key.return) {
        onSubmitRef.current?.(valueRef.current);
        return;
      }
      // Reason: teclas de navegação/controle não devem virar caracteres no
      // valor — Esc/Tab/setas são atalhos de outras camadas (roteador
      // global, troca de campo do formulário pai); Ctrl/Meta evitam
      // capturar sequências de atalho (ex.: Ctrl+C) como texto digitado.
      if (
        key.escape ||
        key.tab ||
        key.upArrow ||
        key.downArrow ||
        key.leftArrow ||
        key.rightArrow ||
        key.pageUp ||
        key.pageDown ||
        key.ctrl ||
        key.meta
      ) {
        return;
      }
      if (key.backspace || key.delete) {
        onChangeRef.current(valueRef.current.slice(0, -1));
        return;
      }
      // Reason: tecla ÚNICA reservada por um controle da tela pai (ex.: "f"
      // cicla o filtro de status na busca da home, M2-07/#30) — ignorada
      // aqui para não virar texto digitado; a tela pai trata o mesmo evento
      // via seu próprio `useInput()`. Só bloqueia o caractere isolado, não
      // uma sequência colada maior que o contenha.
      if (reservedCharsRef.current.includes(input)) {
        return;
      }
      if (input.length > 0) {
        onChangeRef.current(valueRef.current + input);
      }
  }, []);

  useInput(handleInput, { isActive });

  // Reason: cursor em bloco simples (inversão de cor, sem literal — não
  // conta como cor hardcoded) só quando o campo está ativo, reforçando
  // visualmente qual campo recebe o próximo caractere digitado.
  const cursor = isActive ? <Text inverse> </Text> : null;
  // Reserva 1 coluna para o cursor quando ativo — sem isso, o texto truncado
  // + cursor poderia exceder `maxWidth` por 1 caractere.
  const budget = maxWidth !== undefined ? Math.max(maxWidth - (isActive ? 1 : 0), 1) : undefined;

  if (value.length === 0 && placeholder !== undefined) {
    const shownPlaceholder = budget !== undefined ? truncate(placeholder, budget) : placeholder;
    return (
      <Text>
        <Text color={theme.muted}>{shownPlaceholder}</Text>
        {cursor}
      </Text>
    );
  }

  const displayValue = mask !== undefined ? mask.repeat(value.length) : value;
  // truncateStart (não truncate): o usuário edita no FIM da string — é o
  // fim que precisa continuar visível, ver o JSDoc do módulo.
  const shownValue = budget !== undefined ? truncateStart(displayValue, budget) : displayValue;

  return (
    <Text>
      {shownValue}
      {cursor}
    </Text>
  );
}
