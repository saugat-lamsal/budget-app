import { describe, expect, it } from 'vitest';
import * as money from '../src/index.js';

describe('setup', () => {
  it('the money package loads in the test runner', () => {
    expect(money).toBeTypeOf('object');
  });
});
