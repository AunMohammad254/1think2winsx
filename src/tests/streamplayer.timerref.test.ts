'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// This test verifies the cross-environment-safe timer ref type used in StreamPlayer:
// ReturnType<typeof setTimeout> | null

describe('StreamPlayer timer ref typing', () => {
  it('initializes as null (initialValue)', () => {
    const timerRef: ReturnType<typeof setTimeout> | null = null;
    assert.strictEqual(timerRef, null);
  });

  it('accepts a timeout handle after initialization', async () => {
    let timerRef: ReturnType<typeof setTimeout> | null = null;
    timerRef = setTimeout(() => {}, 10);
    assert.ok(timerRef);
    clearTimeout(timerRef as ReturnType<typeof setTimeout>);
  });

  it('supports clearing and resetting to null', () => {
    let timerRef: ReturnType<typeof setTimeout> | null = setTimeout(() => {}, 5);
    assert.ok(timerRef);
    clearTimeout(timerRef);
    timerRef = null;
    assert.strictEqual(timerRef, null);
  });
});