'use strict';

/** Paths of every field named in `names`, anywhere in `value` that holds a non-null value. */
function fieldsPresent(value, names, at = '$') {
  if (value === null || typeof value !== 'object') return [];
  const found = [];
  for (const [key, child] of Object.entries(value)) {
    const where = Array.isArray(value) ? `${at}[${key}]` : `${at}.${key}`;
    if (names.includes(key) && child !== null && child !== undefined) found.push(where);
    found.push(...fieldsPresent(child, names, where));
  }
  return found;
}

/** The items of a list answer, paged (`{ items }`) or not. */
function itemsOf(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.items)) return body.items;
  return [];
}

module.exports = { fieldsPresent, itemsOf };
