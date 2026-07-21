export const MODULE_NAME = 'bundle' as const;

export {
  buildJsonBundle,
  type JsonBundle,
  type JsonBundleEnvelope,
  type JsonBundleMeta,
  type JsonBundleSource,
} from './json.js';
export { buildMarkdownBundle, type MarkdownBundleMeta } from './markdown.js';
export { stableStringify, type JsonValue } from './stable-stringify.js';
