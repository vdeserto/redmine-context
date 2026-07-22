import { describe, expect, it } from 'vitest';

import { KeyringCredentialStore } from '../../src/config/keyring.js';

/**
 * Teste de integração REAL contra o keychain nativo do SO — opt-in.
 *
 * Só roda com `KEYRING_INTEGRATION=1` (evita depender do keychain em CI/headless
 * e evitar prompts de desbloqueio). Usa o service `redmine-context-test` e limpa
 * a entrada ao final, mesmo em caso de falha.
 */
describe.skipIf(!process.env.KEYRING_INTEGRATION)(
  'KeyringCredentialStore (integração real com o keychain do SO)',
  () => {
    it('grava, lê e apaga uma entrada real', async () => {
      const store = new KeyringCredentialStore({ service: 'redmine-context-test' });
      const instance = 'https://redmine-context-test.example';
      const apiKey = `integration-secret-${Date.now()}`;
      try {
        await store.set(instance, apiKey);
        expect(await store.get(instance)).toBe(apiKey);
        await store.delete(instance);
        expect(await store.get(instance)).toBeUndefined();
      } finally {
        // Garante limpeza da entrada de teste mesmo se uma asserção falhar.
        await store.delete(instance);
      }
    });
  },
);
