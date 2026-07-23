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
