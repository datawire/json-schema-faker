import optionAPI from '../api/option.mjs';
import env from './constants.mjs';
import random from './random.mjs';

const RE_NUMERIC = /^(0|[1-9][0-9]*)$/;

function getLocalRef(obj, path, refs) {
  path = decodeURIComponent(path);

  if (refs && refs[path]) return clone(refs[path]); // eslint-disable-line

  const keyElements = path.replace('#/', '/').split('/');

  let schema = (obj.$ref && refs && refs[obj.$ref]) || obj;
  if (!schema && !keyElements[0]) {
    keyElements[0] = obj.$ref.split('#/')[0];
  }
  if (refs && path.includes('#/') && refs[keyElements[0]]) {
    schema = refs[keyElements.shift()];
  }

  if (!keyElements[0]) keyElements.shift();

  while (schema && keyElements.length > 0) {
    const prop = keyElements.shift();

    if (!schema[prop]) {
      throw new Error(`Prop not found: ${prop} (${path})`);
    }

    schema = schema[prop];
  }
  return schema;
}

/**
 * Returns true/false if given value can be treated as number/integer
 *
 * @param value
 * @returns {boolean}
 */
function isNumeric(value) {
  return typeof value === 'string' && RE_NUMERIC.test(value);
}

/**
 * Returns true/false if given value is a number or boolean
 *
 * @param value
 * @returns {boolean}
 */
function isScalar(value) {
  return ['number', 'boolean'].includes(typeof value);
}

 /**
 * Returns true/false whether the object parameter has its own properties defined
 *
 * @param obj
 * @param properties
 * @returns {boolean}
 */
function hasProperties(obj, ...properties) {
  return properties.filter(key => {
    return typeof obj[key] !== 'undefined';
  }).length > 0;
}

/**
 * Normalize generated date YYYY-MM-DD to not have
 * out of range values
 *
 * @param value
 * @returns {string}
 */
function clampDate(value) {
  if (value.includes(' ')) {
    return new Date(value).toISOString().substr(0, 10);
  }

  let [year, month, day] = value.split('T')[0].split('-');

  month = `0${Math.max(1, Math.min(12, month))}`.slice(-2);
  day = `0${Math.max(1, Math.min(31, day))}`.slice(-2);

  return `${year}-${month}-${day}`;
}

/**
 * Normalize generated date-time values YYYY-MM-DDTHH:mm:ss to not have
 * out of range values
 *
 * @param value
 * @returns {string}
 */
function clampDateTime(value) {
  if (value.includes(' ')) {
    return new Date(value).toISOString().substr(0, 10);
  }

  const [datePart, timePart] = value.split('T');
  let [year, month, day] = datePart.split('-');
  let [hour, minute, second] = timePart.substr(0, 8).split(':');

  month = `0${Math.max(1, Math.min(12, month))}`.slice(-2);
  day = `0${Math.max(1, Math.min(31, day))}`.slice(-2);
  hour = `0${Math.max(1, Math.min(23, hour))}`.slice(-2);
  minute = `0${Math.max(1, Math.min(59, minute))}`.slice(-2);
  second = `0${Math.max(1, Math.min(59, second))}`.slice(-2);

  return `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
}

/**
 * Returns typecasted value.
 * External generators (faker, chance, casual) may return data in non-expected formats, such as string, when you might expect an
 * integer. This function is used to force the typecast. This is the base formatter for all result values.
 *
 * @param type
 * @param schema
 * @param callback
 * @returns {any}
 */
function typecast(type, schema, callback) {
  const params = {};

  // normalize constraints
  switch (type || schema.type) {
    case 'integer':
    case 'number':
      if (typeof schema.minimum !== 'undefined') {
        params.minimum = schema.minimum;
      }

      if (typeof schema.maximum !== 'undefined') {
        params.maximum = schema.maximum;
      }

      if (schema.enum) {
        let min = Math.max(params.minimum || 0, 0);
        let max = Math.min(params.maximum || Infinity, Infinity);

        if (schema.exclusiveMinimum && min === schema.minimum) {
          min += schema.multipleOf || 1;
        }

        if (schema.exclusiveMaximum && max === schema.maximum) {
          max -= schema.multipleOf || 1;
        }

        // discard out-of-bounds enumerations
        if (min || max !== Infinity) {
          schema.enum = schema.enum.filter(x => {
            if (x >= min && x <= max) {
              return true;
            }

            return false;
          });
        }
      }

      break;

    case 'string': {
      params.minLength = optionAPI('minLength') || 0;
      params.maxLength = optionAPI('maxLength') || Number.MAX_SAFE_INTEGER;

      if (typeof schema.minLength !== 'undefined') {
        params.minLength = Math.max(params.minLength, schema.minLength);
      }

      if (typeof schema.maxLength !== 'undefined') {
        params.maxLength = Math.min(params.maxLength, schema.maxLength);
      }

      break;
    }

    default: break;
  }

  // execute generator
  let value = callback(params);

  // allow null values to be returned
  if (value === null || value === undefined) {
    return null;
  }

  // normalize output value
  switch (type || schema.type) {
    case 'number':
      value = isNumeric(value) ? parseFloat(value) : value;
      break;

    case 'integer':
      value = isNumeric(value) ? parseInt(value, 10) : value;
      break;

    case 'boolean':
      value = !!value;
      break;

    case 'string': {
      if (isScalar(value)) {
        return value;
      }

      value = String(value);

      const min = Math.max(params.minLength || 0, 0);
      const max = Math.min(params.maxLength || Infinity, Infinity);

      let prev;
      let noChangeCount = 0;

      while (value.length < min) {
        prev = value;

        if (!schema.pattern) {
          value += `${random.pick([' ', '/', '_', '-', '+', '=', '@', '^'])}${value}`;
        } else {
          value += random.randexp(schema.pattern);
        }

        // avoid infinite-loops while filling strings, if no changes
        // are made we just break the loop... see #540
        if (value === prev) {
          noChangeCount += 1;
          if (noChangeCount === 3) {
            break;
          }
        } else {
          noChangeCount = 0;
        }
      }

      if (value.length > max) {
        value = value.substr(0, max);
        const pattern = schema.pattern ? new RegExp(schema.pattern) : null;
        if (pattern && !pattern.test(value)) {
          let temp = value;
          const maxRetries = optionAPI('maxRegexRetry');
          const minLength = Math.max(value.length - maxRetries, min);
          while (temp.length > minLength && !pattern.test(temp)) {
            temp = temp.slice(0, -1);
            if (pattern.test(temp)) {
              value = temp;
            }
          }
        }
      }

      switch (schema.format) {
        case 'date-time':
        case 'datetime':
          value = new Date(clampDateTime(value)).toISOString().replace(/([0-9])0+Z$/, '$1Z');
          break;

        case 'full-date':
        case 'date':
          value = new Date(clampDate(value)).toISOString().substr(0, 10);
          break;

        case 'time':
          value = new Date(`1969-01-01 ${value}`).toISOString().substr(11);
          break;

        default:
          break;
      }
      break;
    }

    default: break;
  }

  return value;
}

function merge(a, b) {
  Object.keys(b).forEach(key => {
    if (typeof b[key] !== 'object' || b[key] === null) {
      a[key] = b[key];
    } else if (Array.isArray(b[key])) {
      a[key] = a[key] || [];
      // fix #292 - skip duplicated values from merge object (b)
      b[key].forEach((value, i) => {
        if (a.type === 'array' && b.type === 'array') {
          a[key][i] = merge(a[key][i] || {}, value, true);
        } else if (Array.isArray(a[key]) && a[key].indexOf(value) === -1) {
          a[key].push(value);
        }
      });
    } else if (typeof a[key] !== 'object' || a[key] === null || Array.isArray(a[key])) {
      a[key] = merge({}, b[key]);
    } else {
      a[key] = merge(a[key], b[key]);
    }
  });

  return a;
}

function clone(obj, cache = new Map()) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (cache.has(obj)) {
    return cache.get(obj);
  }

  if (Array.isArray(obj)) {
    const arr = [];
    cache.set(obj, arr);

    arr.push(...obj.map(x => clone(x, cache)));
    return arr;
  }

  const clonedObj = {};
  cache.set(obj, clonedObj);

  return Object.keys(obj).reduce((prev, cur) => {
    prev[cur] = clone(obj[cur], cache);
    return prev;
  }, clonedObj);
}

function short(schema) {
  const s = JSON.stringify(schema);
  const l = JSON.stringify(schema, null, 2);

  return s.length > 400 ? `${l.substr(0, 400)}...` : l;
}

function anyValue() {
  return random.pick([
    false,
    true,
    null,
    -1,
    NaN,
    Math.PI,
    Infinity,
    undefined,
    [],
    {},
    // FIXME: use built-in random?
    Math.random(),
    Math.random().toString(36).substr(2),
  ]);
}

function hasValue(schema, value) {
  if (schema.enum) return schema.enum.includes(value);
  if (schema.const) return schema.const === value;
}

function notValue(schema, parent) {
  const copy = merge({}, parent);

  if (typeof schema.minimum !== 'undefined') {
    copy.maximum = schema.minimum;
    copy.exclusiveMaximum = true;
  }

  if (typeof schema.maximum !== 'undefined') {
    copy.minimum = schema.maximum > copy.maximum ? 0 : schema.maximum;
    copy.exclusiveMinimum = true;
  }

  if (typeof schema.minLength !== 'undefined') {
    copy.maxLength = schema.minLength;
  }

  if (typeof schema.maxLength !== 'undefined') {
    copy.minLength = schema.maxLength > copy.maxLength ? 0 : schema.maxLength;
  }

  if (schema.type) {
    copy.type = random.pick(env.SCALAR_TYPES.filter(x => {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];

      return types.every(type => {
        // treat both types as _similar enough_ to be skipped equal
        if (x === 'number' || x === 'integer') {
          return type !== 'number' && type !== 'integer';
        }

        return x !== type;
      });
    }));
  } else if (schema.enum) {
    let value;

    do {
      value = anyValue();
    } while (schema.enum.indexOf(value) !== -1);

    copy.enum = [value];
  }

  if (schema.required && copy.properties) {
    schema.required.forEach(prop => {
      delete copy.properties[prop];
    });
  }

  // TODO: explore more scenarios

  return copy;
}

function validateValueForSchema(value, schema) {
  const schemaHasMin = schema.minimum !== undefined;
  const schemaHasMax = schema.maximum !== undefined;

  return (
    (schemaHasMin || schemaHasMax)
    && (!schemaHasMin || value >= schema.minimum)
    && (!schemaHasMax || value <= schema.maximum)
  );
}

// FIXME: evaluate more constraints?
function validate(value, schemas) {
  return !schemas.every(schema => validateValueForSchema(value, schema));
}

function validateValueForOneOf(value, oneOf) {
  const validCount = oneOf.reduce((count, schema) => (count + ((validateValueForSchema(value, schema)) ? 1 : 0)), 0);
  return validCount === 1;
}

function isKey(prop) {
  return ['enum', 'const', 'default', 'examples', 'required', 'definitions', 'items', 'properties'].includes(prop);
}

function omitProps(obj, props) {
  return Object.keys(obj)
    .filter(key => !props.includes(key))
    .reduce((copy, k) => {
      if (Array.isArray(obj[k])) {
        copy[k] = obj[k].slice();
      } else {
        copy[k] = obj[k] instanceof Object
          ? merge({}, obj[k])
          : obj[k];
      }

      return copy;
    }, {});
}

function template(value, schema) {
  if (Array.isArray(value)) {
    return value.map(x => template(x, schema));
  }

  if (typeof value === 'string') {
    value = value.replace(/#\{([\w.-]+)\}/g, (_, $1) => schema[$1]);
  }

  return value;
}

/**
 * Checks if given object is empty (has no properties)
 *
 * @param value
 * @returns {boolean}
 */
function isEmpty(value) {
  return Object.prototype.toString.call(value) === '[object Object]' && !Object.keys(value).length;
}

/**
 * Checks given key is required or if source object was created by a subroutine (already cleaned)
 *
 * @param key
 * @param schema
 * @returns {boolean}
 */
function shouldClean(key, schema) {
  schema = schema.items || schema;

  // fix: when alwaysFakeOptionals is true, need set isRequired to true, see bug:https://github.com/json-schema-faker/json-schema-faker/issues/761
  const alwaysFakeOptionals = optionAPI('alwaysFakeOptionals');
  const isRequired = (Array.isArray(schema.required) && schema.required.includes(key)) || alwaysFakeOptionals;
  const wasCleaned = typeof schema.thunk === 'function' || (schema.additionalProperties && typeof schema.additionalProperties.thunk === 'function');

  return !isRequired && !wasCleaned;
}

/**
 * Cleans up the source object removing empty objects and undefined values
 * Will not remove values which are specified as `required`
 *
 * @param obj
 * @param schema
 * @param isArray
 * @returns {any}
 */
function clean(obj, schema, isArray = false) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj
      .map(value => clean(value, schema?.items, true))
      .filter(value => typeof value !== 'undefined');
  }

  Object.keys(obj).forEach(k => {
    if (isEmpty(obj[k])) {
      if (schema && shouldClean(k, schema)) {
        delete obj[k];
      }
    } else {
      // should obtain the correct schema
      let subSchema = schema;
      if (schema && schema.properties && schema.properties[k]) {
        subSchema = schema.properties[k];
      }
      const value = clean(obj[k], subSchema);

      if (!isEmpty(value)) {
        obj[k] = value;
      }
    }
    if (typeof obj[k] === 'undefined') {
      delete obj[k];
    }
  });

  if (!Object.keys(obj).length && isArray) {
    return undefined;
  }

  return obj;
}

export default {
  hasProperties,
  getLocalRef,
  omitProps,
  typecast,
  merge,
  clone,
  short,
  hasValue,
  notValue,
  anyValue,
  validate,
  validateValueForSchema,
  validateValueForOneOf,
  isKey,
  template,
  shouldClean,
  clean,
  isEmpty,
  clampDate,
};
