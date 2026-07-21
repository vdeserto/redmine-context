export const TOOL_NAME = 'redmine-context';
// Manter em sincronia com package.json (automatizado no empacotamento do M5).
export const TOOL_VERSION = '0.1.0';

// Superfície pública do core: contrato de tipos + padrão de progresso (ADR-005).
// As superfícies devem consumir o core somente por aqui / por ./contract.js.
export * from './contract.js';
