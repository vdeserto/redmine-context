import { describe, expect, it } from 'vitest';

import { TOOL_NAME, TOOL_VERSION } from '../src/index.js';
import { CORE_MODULES } from '../src/core.js';

describe('smoke: toolchain e estrutura dos 6 módulos do core (ADR-005)', () => {
  it('expõe nome e versão da ferramenta', () => {
    expect(TOOL_NAME).toBe('redmine-context');
    expect(TOOL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('declara os 6 módulos do core na ordem do ADR-005', () => {
    expect(CORE_MODULES).toEqual(['client', 'normalize', 'extract', 'bundle', 'config', 'cache']);
  });
});
