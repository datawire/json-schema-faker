import optionAPI from '../api/option.mjs';
import createTraverse from './traverse.mjs';
import utils from './utils.mjs';
import buildResolveSchema from './buildResolveSchema.mjs';

// TODO provide types?
function run(refs, schema, container, synchronous) {
  if (Object.prototype.toString.call(schema) !== '[object Object]') {
    throw new Error(`Invalid input, expecting object but given ${typeof schema}`);
  }

  const refDepthMin = optionAPI('refDepthMin') || 0;
  const refDepthMax = optionAPI('refDepthMax') || 3;
  const ticks = optionAPI('ticks') ?? -1;
  const traverse = createTraverse(ticks);

  try {
    const { resolveSchema } = buildResolveSchema({
      refs,
      schema,
      container,
      synchronous,
      refDepthMin,
      refDepthMax,
    });
    return traverse(utils.clone(schema), [], resolveSchema);
  } catch (e) {
    if (e.path) {
      throw new Error(`${e.message} in /${e.path.join('/')}`);
    } else {
      throw e;
    }
  }
}

export default run;
