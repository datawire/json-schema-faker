import { expect } from 'chai';
import traverse from '../../../src/lib/core/traverse.mjs';

function mockResolve(schema) {
  return schema;
}

describe('Traverse', () => {
  it('array list value and context', () => {
    const schema = {
      title: 'Foo array',
      type: 'array',
      items: {
        description: 'a string in the array',
        type: 'string',
        generate: () => 'foo',
      },
      minItems: 1,
      maxItems: 1,
    };

    expect(traverse(schema, [], mockResolve, schema)).to.eql({
      value: ['foo'],
      context: {
        schemaPath: [],
        title: schema.title,
        items: [
          {
            schemaPath: ['items'],
            description: schema.items.description,
          },
        ],
      },
    });
  });

  it('array tuple value and context', () => {
    const schema = {
      type: 'array',
      items: [
        {
          title: 'Always zero',
          const: 0,
        },
        {
          description: 'Some string',
          type: 'string',
          generate: () => 'foo',
        },
      ],
    };

    expect(traverse(schema, [], mockResolve, schema)).to.eql({
      value: [0, 'foo'],
      context: {
        schemaPath: [],
        items: [
          {
            schemaPath: ['items', 0],
            title: schema.items[0].title,
          },
          {
            schemaPath: ['items', 1],
            description: schema.items[1].description,
          },
        ],
      },
    });
  });
});
