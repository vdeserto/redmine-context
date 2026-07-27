/**
 * Contexto da INSTÂNCIA resolvida da TUI (#187).
 *
 * O `runTui` resolve a instância uma vez no boot — `REDMINE_URL` (env) tem
 * precedência; sem ela, usa a URL persistida no `login` — e a expõe aqui para as
 * telas que precisam saber a ORIGEM (`config`/`doctor`) e para o `logout` também
 * limpar a URL persistida. Os hooks de dados continuam lendo `process.env`
 * (populado no boot), então este contexto carrega só metadados + a ação de limpar.
 */
import { createContext, useContext, type ReactNode } from 'react';

/** Origem da instância em uso na TUI. */
export type InstanceOrigin = 'env' | 'config' | 'none';

/** Metadados da instância resolvida + ação para limpar a URL persistida. */
export interface InstanceInfo {
  /** URL da instância em uso, ou `undefined` se nenhuma. */
  readonly url?: string;
  /** De onde veio: `env` (REDMINE_URL), `config` (persistida) ou `none`. */
  readonly origin: InstanceOrigin;
  /** Remove a URL persistida (usado no logout); no-op se não houver store. */
  readonly clearPersisted: () => Promise<void>;
}

/** Default seguro: sem instância e limpeza no-op (usado fora do provider, ex.: testes). */
const DEFAULT: InstanceInfo = {
  origin: 'none',
  clearPersisted: async () => undefined,
};

const InstanceContext = createContext<InstanceInfo>(DEFAULT);

/** Provider da instância resolvida (montado pelo `runTui`). */
export function InstanceProvider({
  value,
  children,
}: {
  value: InstanceInfo;
  children: ReactNode;
}): ReactNode {
  return <InstanceContext.Provider value={value}>{children}</InstanceContext.Provider>;
}

/** Lê a instância resolvida no contexto (default seguro fora do provider). */
export function useInstance(): InstanceInfo {
  return useContext(InstanceContext);
}

/**
 * `true` se a credencial de AMBIENTE (`REDMINE_API_KEY`) pode ser usada nesta
 * sessão. SEGURANÇA (#187): quando a instância veio de fonte MUTÁVEL (`settings.json`
 * persistido, origem `config`), retorna `false` — a env-key é instance-agnóstica e
 * não pode ser enviada a uma URL controlável por arquivo. Espelha o `allowEnvFallback`
 * já aplicado na CLI (`issue`) e no MCP; deve ser passado no `CredentialCascadeOptions`
 * de TODA resolução de credencial da TUI.
 */
export function useEnvFallbackAllowed(): boolean {
  return useInstance().origin !== 'config';
}
