import { MODULE_NAME as bundle } from './bundle/index.js';
import { MODULE_NAME as cache } from './cache/index.js';
import { MODULE_NAME as client } from './client/index.js';
import { MODULE_NAME as config } from './config/index.js';
import { MODULE_NAME as extract } from './extract/index.js';
import { MODULE_NAME as normalize } from './normalize/index.js';

// Os 6 módulos do core, na ordem das camadas do ADR-005.
export const CORE_MODULES = [client, normalize, extract, bundle, config, cache] as const;
