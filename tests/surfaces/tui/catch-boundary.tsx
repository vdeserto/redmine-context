/**
 * Error boundary de teste para asserir que um hook de contexto LANÇA quando usado
 * fora do seu provider — de forma independente do ambiente.
 *
 * O ink renderiza erros de forma diferente sob `CI=true` (degrada e NÃO escreve o
 * erro no frame), então `expect(lastFrame()).toContain(msg)` sobre a renderização
 * de erro do ink falha no CI (frames vazios). Este boundary captura o erro lançado
 * no render e o expõe como `<Text>` NORMAL — o que o hook lança é o que importa, e
 * a asserção passa igual no CI e localmente.
 *
 * Uso: `render(<Catch><ComponenteQueLanca /></Catch>)` e assere `lastFrame()`.
 */
import { Component, type ReactNode } from 'react';
import { Text } from 'ink';

export class Catch extends Component<{ readonly children: ReactNode }, { readonly message: string }> {
  state = { message: '' };

  static getDerivedStateFromError(error: unknown): { message: string } {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  render(): ReactNode {
    return this.state.message === '' ? this.props.children : <Text>{this.state.message}</Text>;
  }
}
