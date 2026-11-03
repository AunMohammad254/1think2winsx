import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Storage Mock in vitest.setup.ts', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('shares references between window and globalThis', () => {
    expect(globalThis.localStorage).toBeDefined();
    expect(window.localStorage).toBe(globalThis.localStorage);
    expect(globalThis.sessionStorage).toBeDefined();
    expect(window.sessionStorage).toBe(globalThis.sessionStorage);
    expect(globalThis.localStorage).not.toBe(globalThis.sessionStorage);
  });

  it('supports basic CRUD operations via standard methods', () => {
    expect(localStorage.length).toBe(0);
    localStorage.setItem('k1', 'v1');
    localStorage.setItem('k2', 'v2');
    expect(localStorage.length).toBe(2);
    expect(localStorage.getItem('k1')).toBe('v1');
    expect(localStorage.getItem('k2')).toBe('v2');
    expect(localStorage.getItem('nonexistent')).toBeNull();

    expect(localStorage.key(0)).toBe('k1');
    expect(localStorage.key(1)).toBe('k2');
    expect(localStorage.key(2)).toBeNull();

    localStorage.removeItem('k1');
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem('k1')).toBeNull();

    localStorage.clear();
    expect(localStorage.length).toBe(0);
    expect(localStorage.getItem('k2')).toBeNull();
  });

  it('supports direct property access, assignment, and deletion', () => {
    // Property assignment
    (localStorage as any).user = 'alice';
    expect(localStorage.getItem('user')).toBe('alice');
    expect((localStorage as any).user).toBe('alice');
    expect('user' in localStorage).toBe(true);

    // Iteration / Object.keys
    expect(Object.keys(localStorage)).toContain('user');

    // Deletion
    delete (localStorage as any).user;
    expect(localStorage.getItem('user')).toBeNull();
    expect((localStorage as any).user).toBeUndefined();
    expect('user' in localStorage).toBe(false);
  });

  it('allows pass-through spying on Storage.prototype methods without brand check errors', () => {
    localStorage.setItem('testKey', 'testVal');

    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem');
    const clearSpy = vi.spyOn(Storage.prototype, 'clear');

    // Call getItem
    const val = localStorage.getItem('testKey');
    expect(getItemSpy).toHaveBeenCalledWith('testKey');
    expect(val).toBe('testVal');

    // Call setItem
    localStorage.setItem('anotherKey', 'anotherVal');
    expect(setItemSpy).toHaveBeenCalledWith('anotherKey', 'anotherVal');
    expect(localStorage.getItem('anotherKey')).toBe('anotherVal');

    // Call removeItem
    localStorage.removeItem('anotherKey');
    expect(removeItemSpy).toHaveBeenCalledWith('anotherKey');
    expect(localStorage.getItem('anotherKey')).toBeNull();

    // Call clear
    localStorage.clear();
    expect(clearSpy).toHaveBeenCalled();
    expect(localStorage.length).toBe(0);

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
    removeItemSpy.mockRestore();
    clearSpy.mockRestore();
  });

  it('allows mocking implementation on Storage.prototype methods', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });

    expect(() => localStorage.getItem('any')).toThrow('storage blocked');
    spy.mockRestore();
    expect(localStorage.getItem('any')).toBeNull();
  });

  it('isolates localStorage and sessionStorage', () => {
    localStorage.setItem('token', 'local-token');
    sessionStorage.setItem('token', 'session-token');

    expect(localStorage.getItem('token')).toBe('local-token');
    expect(sessionStorage.getItem('token')).toBe('session-token');

    localStorage.clear();
    expect(localStorage.getItem('token')).toBeNull();
    expect(sessionStorage.getItem('token')).toBe('session-token');

    sessionStorage.clear();
    expect(sessionStorage.getItem('token')).toBeNull();
  });

  it('protects length property from being deleted by deleteProperty', () => {
    localStorage.setItem('k1', 'v1');
    expect(localStorage.length).toBe(1);

    // Deleting localStorage.length should not destroy length or cause it to return undefined
    delete (localStorage as any).length;
    expect(localStorage.length).toBe(1);

    // Storing a key named 'length' via setItem
    localStorage.setItem('length', 'custom-len');
    expect(localStorage.getItem('length')).toBe('custom-len');
    expect(localStorage.length).toBe(2);

    // Deleting the stored key named 'length'
    delete (localStorage as any).length;
    expect(localStorage.getItem('length')).toBeNull();
    expect(localStorage.length).toBe(1);
  });

  it('handles non-configurable prototype length fallback on mock instances', () => {
    // Simulate an environment like Node 22 where Storage.prototype.length is non-configurable
    class NativeMockStorage {}
    Object.defineProperty(NativeMockStorage.prototype, 'length', {
      get() {
        throw new TypeError('Illegal invocation: native Storage.prototype.length called on invalid receiver');
      },
      configurable: false,
      enumerable: true,
    });

    // Verify non-configurable property descriptor check
    const desc = Object.getOwnPropertyDescriptor(NativeMockStorage.prototype, 'length');
    expect(desc?.configurable).toBe(false);

    // Verify instance-level length getter fallback
    const mockTarget: any = Object.create(NativeMockStorage.prototype);
    const mockStore = new Map<string, string>();
    const mockStoreSymbol = Symbol('test_store');
    mockTarget[mockStoreSymbol] = mockStore;

    Object.defineProperty(mockTarget, 'length', {
      configurable: true,
      enumerable: false,
      get(this: unknown): number {
        const store = (this as Record<symbol, Map<string, string>> | null | undefined)?.[mockStoreSymbol] ?? mockTarget[mockStoreSymbol];
        return store instanceof Map ? store.size : 0;
      },
    });

    expect(mockTarget.length).toBe(0);
    mockStore.set('key1', 'val1');
    expect(mockTarget.length).toBe(1);
    mockStore.set('key2', 'val2');
    expect(mockTarget.length).toBe(2);
    mockStore.delete('key1');
    expect(mockTarget.length).toBe(1);
    mockStore.clear();
    expect(mockTarget.length).toBe(0);
  });
});

