import $RefParser from 'json-schema-ref-parser';

import { setDependencies } from './vendor.mjs';

setDependencies({ $RefParser });

export { default, JSONSchemaFaker } from './index.mjs';
