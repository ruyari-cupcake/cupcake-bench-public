import test from 'node:test';
import assert from 'node:assert/strict';
import { makeConfig } from '../config.js';
import { catalog } from '../src/catalog.js';

test('catalog lists configured selections', () => {
  assert.deepEqual(catalog(makeConfig()).map(({ destination, account }) => [destination, account]), [["proof", "mono"], ["proof", "colour"], ["edition", "mono"], ["edition", "colour"]]);
});
