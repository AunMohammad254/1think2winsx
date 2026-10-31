import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Cleanup after each test
afterEach(() => {
    cleanup();
});

// Mock Next.js router
vi.mock('next/navigation', () => ({
    useRouter: () => ({
        push: vi.fn(),
        replace: vi.fn(),
        back: vi.fn(),
        forward: vi.fn(),
        refresh: vi.fn(),
        prefetch: vi.fn(),
    }),
    usePathname: () => '/',
    useSearchParams: () => new URLSearchParams(),
}));

// Mock Next.js dynamic import
vi.mock('next/dynamic', () => ({
    default: (_fn: () => Promise<{ default: React.ComponentType }>) => {
        const Component = () => null;
        return Component;
    },
}));

// Browser-only mocks. Guarded so test files that opt into the Node environment
// (`// @vitest-environment node`, e.g. server-side lib/route tests that need the real
// AbortSignal.timeout/any) can share this setup file.
if (typeof window !== 'undefined') {
    // Mock window.matchMedia
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })),
    });

    // Mock IntersectionObserver
    class MockIntersectionObserver {
        observe = vi.fn();
        disconnect = vi.fn();
        unobserve = vi.fn();
    }

    Object.defineProperty(window, 'IntersectionObserver', {
        writable: true,
        value: MockIntersectionObserver,
    });

    // Mock ResizeObserver
    class MockResizeObserver {
        observe = vi.fn();
        disconnect = vi.fn();
        unobserve = vi.fn();
    }

    Object.defineProperty(window, 'ResizeObserver', {
        writable: true,
        value: MockResizeObserver,
    });
}

// Storage mock supporting standard localStorage operations and Storage.prototype spies
const storeSymbol = Symbol('storage_store');

if (typeof Storage === 'undefined') {
    class MockStorage {}
    (globalThis as unknown as { Storage: typeof MockStorage }).Storage = MockStorage;
    if (typeof window !== 'undefined') {
        (window as unknown as { Storage: typeof MockStorage }).Storage = MockStorage;
    }
}

// Implement standard Web Storage methods on Storage.prototype so prototype spies work without brand check errors
Storage.prototype.getItem = function (this: unknown, key: string): string | null {
    const store = (this as Record<symbol, Map<string, string>> | null | undefined)?.[storeSymbol];
    return store instanceof Map ? (store.get(String(key)) ?? null) : null;
};

Storage.prototype.setItem = function (this: unknown, key: string, value: string): void {
    const target = this as Record<symbol, Map<string, string>> | null | undefined;
    if (!target) return;
    let store = target[storeSymbol];
    if (!(store instanceof Map)) {
        store = new Map<string, string>();
        target[storeSymbol] = store;
    }
    store.set(String(key), String(value));
};

Storage.prototype.removeItem = function (this: unknown, key: string): void {
    const store = (this as Record<symbol, Map<string, string>> | null | undefined)?.[storeSymbol];
    if (store instanceof Map) {
        store.delete(String(key));
    }
};

Storage.prototype.clear = function (this: unknown): void {
    const store = (this as Record<symbol, Map<string, string>> | null | undefined)?.[storeSymbol];
    if (store instanceof Map) {
        store.clear();
    }
};

Storage.prototype.key = function (this: unknown, index: number): string | null {
    const store = (this as Record<symbol, Map<string, string>> | null | undefined)?.[storeSymbol];
    if (!(store instanceof Map)) return null;
    const keys = Array.from(store.keys());
    return keys[index] ?? null;
};

let prototypeLengthDefined = false;
try {
    const desc = Object.getOwnPropertyDescriptor(Storage.prototype, 'length');
    if (!desc || desc.configurable) {
        Object.defineProperty(Storage.prototype, 'length', {
            configurable: true,
            enumerable: false,
            get(this: unknown): number {
                const store = (this as Record<symbol, Map<string, string>> | null | undefined)?.[storeSymbol];
                return store instanceof Map ? store.size : 0;
            },
        });
        prototypeLengthDefined = true;
    }
} catch {
    prototypeLengthDefined = false;
}

const createStorageMock = (): Storage => {
    const target: any = Object.create(Storage.prototype);
    target[storeSymbol] = new Map<string, string>();

    if (!prototypeLengthDefined) {
        Object.defineProperty(target, 'length', {
            configurable: true,
            enumerable: false,
            get(this: unknown): number {
                const store = (this as Record<symbol, Map<string, string>> | null | undefined)?.[storeSymbol] ?? target[storeSymbol];
                return store instanceof Map ? store.size : 0;
            },
        });
    }

    const proxy = new Proxy(target, {
        get(t: any, prop: string | symbol, receiver: unknown) {
            if (typeof prop === 'string') {
                if (prop in t || prop === 'then') {
                    return Reflect.get(t, prop, receiver);
                }
                const store = t[storeSymbol] as Map<string, string> | undefined;
                if (store instanceof Map && store.has(prop)) {
                    return store.get(prop);
                }
            }
            return Reflect.get(t, prop, receiver);
        },
        set(t: any, prop: string | symbol, value: unknown, receiver: unknown) {
            if (typeof prop === 'string') {
                if (prop in t) {
                    return Reflect.set(t, prop, value, receiver);
                }
                (t as Storage).setItem(prop, String(value));
                return true;
            }
            return Reflect.set(t, prop, value, receiver);
        },
        deleteProperty(t: any, prop: string | symbol) {
            if (typeof prop === 'string') {
                if (prop === 'length') {
                    const store = t[storeSymbol] as Map<string, string> | undefined;
                    if (store instanceof Map) {
                        store.delete('length');
                    }
                    return true;
                }
                if (Object.prototype.hasOwnProperty.call(t, prop)) {
                    return Reflect.deleteProperty(t, prop);
                }
                (t as Storage).removeItem(prop);
                return true;
            }
            return Reflect.deleteProperty(t, prop);
        },
        has(t: any, prop: string | symbol) {
            if (typeof prop === 'string') {
                const store = t[storeSymbol] as Map<string, string> | undefined;
                if (store instanceof Map && store.has(prop)) {
                    return true;
                }
            }
            return Reflect.has(t, prop);
        },
        ownKeys(t: any) {
            const store = t[storeSymbol] as Map<string, string> | undefined;
            const storeKeys = store instanceof Map ? Array.from(store.keys()) : [];
            return Array.from(new Set([...Reflect.ownKeys(t), ...storeKeys]));
        },
        getOwnPropertyDescriptor(t: any, prop: string | symbol) {
            if (Object.prototype.hasOwnProperty.call(t, prop)) {
                return Reflect.getOwnPropertyDescriptor(t, prop);
            }
            if (typeof prop === 'string') {
                const store = t[storeSymbol] as Map<string, string> | undefined;
                if (store instanceof Map && store.has(prop)) {
                    return {
                        value: store.get(prop),
                        writable: true,
                        enumerable: true,
                        configurable: true,
                    };
                }
            }
            return undefined;
        },
    });

    return proxy as Storage;
};

const localStorageMock = createStorageMock();
const sessionStorageMock = createStorageMock();

Object.defineProperty(globalThis, 'localStorage', {
    writable: true,
    configurable: true,
    value: localStorageMock,
});

Object.defineProperty(globalThis, 'sessionStorage', {
    writable: true,
    configurable: true,
    value: sessionStorageMock,
});

if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', {
        writable: true,
        configurable: true,
        value: localStorageMock,
    });
    Object.defineProperty(window, 'sessionStorage', {
        writable: true,
        configurable: true,
        value: sessionStorageMock,
    });
}
