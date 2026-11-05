'use strict';

/**
 * The shape of a JSON response: field names and value types, not values.
 * Two environments "answer the same" when their shapes agree. Values differ
 * by nature (ids, dates, other people's listings), so they are not compared.
 *
 * Shapes: 'string' | 'number' | 'boolean' | 'null' | 'unknown'
 *       | { array: Shape } | { object: { key: Shape } }
 */
function shapeOf(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) {
    return { array: value.map(shapeOf).reduce(mergeShapes, 'unknown') };
  }
  if (typeof value === 'object') {
    const object = {};
    for (const key of Object.keys(value).sort()) object[key] = shapeOf(value[key]);
    return { object };
  }
  return typeof value;
}

/** One shape for every item of an array: keys are united, null gives way to a type. */
function mergeShapes(a, b) {
  if (a === 'unknown' || a === 'null') return b === 'unknown' ? a : b;
  if (b === 'unknown' || b === 'null') return a;
  if (typeof a === 'string' || typeof b === 'string') return a === b ? a : 'mixed';
  if (a.array && b.array) return { array: mergeShapes(a.array, b.array) };
  if (a.object && b.object) {
    const object = { ...a.object };
    for (const [key, shape] of Object.entries(b.object)) {
      object[key] = key in object ? mergeShapes(object[key], shape) : shape;
    }
    return { object };
  }
  return 'mixed';
}

/**
 * Where two shapes disagree, as readable lines. A null or empty array on one
 * side matches anything on the other: that is data, not a different contract.
 */
function shapeDifferences(a, b, at = '$') {
  if (a === b) return [];
  if (a === 'null' || b === 'null' || a === 'unknown' || b === 'unknown') return [];
  if (typeof a === 'string' || typeof b === 'string') {
    return [`${at}: ${describe(a)} vs ${describe(b)}`];
  }
  if (a.array && b.array) return shapeDifferences(a.array, b.array, `${at}[]`);
  if (a.object && b.object) {
    const lines = [];
    const keys = new Set([...Object.keys(a.object), ...Object.keys(b.object)]);
    for (const key of [...keys].sort()) {
      if (!(key in a.object)) lines.push(`${at}.${key}: missing vs present`);
      else if (!(key in b.object)) lines.push(`${at}.${key}: present vs missing`);
      else lines.push(...shapeDifferences(a.object[key], b.object[key], `${at}.${key}`));
    }
    return lines;
  }
  return [`${at}: ${describe(a)} vs ${describe(b)}`];
}

function describe(shape) {
  if (typeof shape === 'string') return shape;
  return shape.array ? 'array' : 'object';
}

module.exports = { shapeOf, shapeDifferences };
