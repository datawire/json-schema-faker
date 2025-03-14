import utils from './utils.mjs';
import random from './random.mjs';
import ParseError from './error.mjs';
import inferType from './infer.mjs';
import toMaybeDraft4 from './toMaybeDraft4.mjs';
import types from '../types/index.mjs';
import optionAPI from '../api/option.mjs';

function getMeta({ $comment: comment, title, description }) {
  return Object.entries({ comment, title, description })
    .filter(([, value]) => value)
    .reduce((memo, [k, v]) => {
      memo[k] = v;
      return memo;
    }, {});
}

// TODO provide types
function createTraverse(ticks) {
  function traverse(schema, path, resolve, rootSchema) {
    if (ticks > 0) {
      ticks -= 1;
    }

    if (ticks === 0) {
      throw new RangeError('Schema size exceeded');
    }

    schema = resolve(schema, null, path);

    if (schema && (schema.oneOf || schema.anyOf || schema.allOf)) {
      schema = resolve(schema, null, path);
    }

    if (!schema) {
      throw new Error(`Cannot traverse at '${path.join('.')}', given '${JSON.stringify(rootSchema)}'`);
    }

    const context = {
      ...getMeta(schema),
      schemaPath: path,
    };

    // default values has higher precedence
    if (path[path.length - 1] !== 'properties') {
      // example values have highest precedence
      if (optionAPI('useExamplesValue') && Array.isArray(schema.examples)) {
        // include `default` value as example too
        const fixedExamples = schema.examples
          .concat('default' in schema ? [schema.default] : []);

        return { value: utils.typecast(null, schema, () => random.pick(fixedExamples)), context };
      }
      // If schema contains single example property
      if (optionAPI('useExamplesValue') && typeof schema.example !== 'undefined') {
        return { value: utils.typecast(null, schema, () => schema.example), context };
      }

      if (optionAPI('useDefaultValue') && 'default' in schema) {
        if (schema.default !== '' || !optionAPI('replaceEmptyByRandomValue')) {
          return { value: schema.default, context };
        }
      }

      if ('template' in schema) {
        return { value: utils.template(schema.template, rootSchema), context };
      }

      if ('const' in schema) {
        return { value: schema.const, context };
      }
    }

    if (schema.not && typeof schema.not === 'object') {
      schema = utils.notValue(schema.not, utils.omitProps(schema, ['not']));

      // build new object value from not-schema!
      if (schema.type && schema.type === 'object') {
        const { value, context: innerContext } = traverse(schema, path.concat(['not']), resolve, rootSchema);
        return { value: utils.clean(value, schema, false), context: { ...context, items: innerContext } };
      }
    }

    // thunks can return sub-schemas
    if (typeof schema.thunk === 'function') {
      // result is already cleaned in thunk
      const { value, context: innerContext } = traverse(schema.thunk(rootSchema), path, resolve);
      return { value, context: { ...context, items: innerContext } };
    }

    // TODO remove the ugly overcome
    let type = schema.type;

    if (Array.isArray(type)) {
      type = random.pick(type);
    } else if (typeof type === 'undefined') {
      // Attempt to infer the type
      type = inferType(schema, path) || type;

      if (type) {
        schema.type = type;
      }
    }

    if (typeof schema.generate === 'function') {
      const retVal = utils.typecast(null, schema, () => schema.generate(rootSchema, path));
      const retType = retVal === null ? 'null' : typeof retVal;
      if (retType === type
        || (retType === 'number' && type === 'integer')
        || (Array.isArray(retVal) && type === 'array')) {
        return { value: retVal, context };
      }
    }

    if (typeof schema.pattern === 'string') {
      return { value: utils.typecast('string', schema, () => random.randexp(schema.pattern)), context };
    }

    if (Array.isArray(schema.enum)) {
      return { value: utils.typecast(null, schema, () => random.pick(schema.enum)), context };
    }

    if (typeof type === 'string') {
      if (!types[type]) {
        if (optionAPI('failOnInvalidTypes')) {
          throw new ParseError(`unknown primitive ${utils.short(type)}`, path.concat(['type']));
        } else {
          const value = optionAPI('defaultInvalidTypeProduct');

          if (typeof value === 'string' && types[value]) {
            return { value: types[value](schema, path, resolve, traverse), context };
          }

          return { value, context };
        }
      } else {
        try {
          const innerResult = types[type](schema, path, resolve, traverse);
          if (type === 'array') {
            return {
              value: innerResult.map(({ value }) => value),
              context: {
                ...context,
                items: innerResult.map(
                  Array.isArray(schema.items)
                    ? ({ context: c }) => c
                    : ({ context: c }) => ({
                      ...c,
                      // we have to remove the index from the path to get the real schema path
                      schemaPath: c.schemaPath.slice(0, -1),
                    })),
              },
            };
          }
          if (type === 'object') {
            return innerResult !== null
              ? { value: innerResult.value, context: { ...context, items: innerResult.context } }
              : { value: {}, context };
          }
          return { value: innerResult, context };
        } catch (e) {
          if (e instanceof RangeError) {
            throw e;
          } else if (typeof e.path === 'undefined') {
            throw new ParseError(e.stack, path);
          }
          throw e;
        }
      }
    }

    if (Array.isArray(schema)) {
      throw new Error('Unexpected array schema');
    }

    if (schema.faker) {
      return { value: schema.faker, context };
    }

    return { value: toMaybeDraft4(schema), context };
  }

  traverse.properties = (object, path, resolve) => {
    object = resolve(object, null, path);
    let valueCopy = {};
    let contextCopy = {};

    const pruneProperties = optionAPI('pruneProperties') || [];
    Object.keys(object).forEach(prop => {
      if (pruneProperties.includes(prop)) return;
      if (object[prop] === null) return;
      if (typeof object[prop] === 'object' && prop !== 'definitions') {
        const { value, context: innerContext } = traverse(object[prop], path.concat([prop]), resolve, valueCopy);
        valueCopy[prop] = utils.clean(value, object[prop], false);
        contextCopy[prop] = innerContext;

        if (valueCopy[prop] === null && optionAPI('omitNulls')) {
          delete valueCopy[prop];
          delete contextCopy[prop];
        }
      } else {
        valueCopy[prop] = object[prop];
      }
    });

    return {
      value: valueCopy,
      context: contextCopy,
    };
  };

  return traverse;
}

export default createTraverse;
