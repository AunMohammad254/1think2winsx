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
    if (typeof Storage !== 'undefined') {
        const storeKey = Symbol('store');
        type StorageWithStore = Storage & { [storeKey]?: Record<string, string> };
        const getStore = (s: StorageWithStore) => (s[storeKey] = s[storeKey] || {});

        Storage.prototype.getItem = function (this: StorageWithStore, key: string) {
            return getStore(this)[key] ?? null;
        };
        Storage.prototype.setItem = function (this: StorageWithStore, key: string, value: string) {
            getStore(this)[key] = String(value);
        };
        Storage.prototype.removeItem = function (this: StorageWithStore, key: string) {
            delete getStore(this)[key];
        };
        Storage.prototype.clear = function (this: StorageWithStore) {
            this[storeKey] = {};
        };
        Storage.prototype.key = function (this: StorageWithStore, index: number) {
            return Object.keys(getStore(this))[index] ?? null;
        };
        Object.defineProperty(Storage.prototype, 'length', {
            get(this: StorageWithStore) {
                return Object.keys(getStore(this)).length;
            },
            configurable: true,
        });

        if (!globalThis.localStorage || typeof globalThis.localStorage.clear !== 'function') {
            const ls = Object.create(Storage.prototype);
            Object.defineProperty(globalThis, 'localStorage', { writable: true, configurable: true, value: ls });
            Object.defineProperty(window, 'localStorage', { writable: true, configurable: true, value: ls });
        }
        if (!globalThis.sessionStorage || typeof globalThis.sessionStorage.clear !== 'function') {
            const ss = Object.create(Storage.prototype);
            Object.defineProperty(globalThis, 'sessionStorage', { writable: true, configurable: true, value: ss });
            Object.defineProperty(window, 'sessionStorage', { writable: true, configurable: true, value: ss });
        }
    }
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
