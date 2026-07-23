export const MODULE_NAME = 'cache' as const;

export {
  DEFAULT_STALE_LOCK_TTL_MS,
  instanceHash,
  serializeCacheKey,
  type AttachmentCacheKey,
  type CacheKey,
  type CacheStore,
  type CacheStoreOptions,
  type ExtractorParams,
  type GcContext,
  type GcHook,
  type IssueCacheKey,
} from './contract.js';
export { getOrCompute } from './get-or-compute.js';
export { InMemoryCacheStore } from './memory.js';
export { DiskCacheStore, defaultCacheDir, type DiskCacheStoreOptions } from './disk.js';
export {
  buildAttachmentKey,
  deriveAttachmentDigest,
  type BuildAttachmentKeyInput,
  type ExtractorConfig,
} from './keys.js';

export { DiskCacheIndex, INDEX_FILE_NAME } from './disk-index.js';
export type { CacheIndexEntry, CacheEntryType } from './disk-index.js';

export {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_ORIGINAL_FRACTION,
  planGc,
  resolveEvictionTarget,
  type GcCandidate,
  type GcDecision,
  type GcPolicyOptions,
} from './gc.js';
