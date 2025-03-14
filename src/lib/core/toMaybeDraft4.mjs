const KNOWN_VOCABULARY = new Set([
  '$ref',
  'id',
  '$schema',
  'title',
  'description',
  'default',
  'multipleOf',
  'maximum',
  'exclusiveMaximum',
  'minimum',
  'exclusiveMinimum',
  'maxLength',
  'minLength',
  'pattern',
  'additionalItems',
  'items',
  'maxItems',
  'minItems',
  'uniqueItems',
  'maxProperties',
  'minProperties',
  'required',
  'additionalProperties',
  'definitions',
  'properties',
  'patternProperties',
  'dependencies',
  'enum',
  'type',
  'format',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
]);

function toMaybeDraft4(maybeSchema) {
  const keys = Object.keys(maybeSchema);
  const maybeDraft4 = {};
  for (const key of keys) {
    if (KNOWN_VOCABULARY.has(key)) {
      toMaybeDraft4[key] = maybeSchema[key];
    }
  }

  return maybeDraft4;
}

export default toMaybeDraft4;
