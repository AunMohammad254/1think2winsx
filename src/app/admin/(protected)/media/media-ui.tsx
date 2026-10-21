/** Small pieces shared by the media pages. */
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

/** "1 image", "3 images" */
export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** Dialog over the page with a title and a close button. */
export function Modal({
  title,
  onClose,
  wide = false,
  children,
}: {
  title: string;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative max-h-[90vh] w-full overflow-y-auto rounded-2xl border border-white/15 bg-gray-900 p-6 shadow-2xl ${
          wide ? 'max-w-2xl' : 'max-w-lg'
        }`}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-lg p-1 text-gray-400 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>
        <h3 className="mb-4 pr-8 text-lg font-bold text-white">{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatDate(value: string | number): string {
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function Pager({
  page,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return null;
  return (
    <div className="mt-6 flex items-center justify-center gap-3 text-sm text-gray-300">
      <button
        type="button"
        onClick={() => onPage(page - 1)}
        disabled={page === 0}
        className="rounded-lg bg-gray-800 px-3 py-1.5 hover:bg-gray-700 disabled:opacity-40"
      >
        Previous
      </button>
      <span>
        Page {page + 1} of {pages}
      </span>
      <button
        type="button"
        onClick={() => onPage(page + 1)}
        disabled={page >= pages - 1}
        className="rounded-lg bg-gray-800 px-3 py-1.5 hover:bg-gray-700 disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}
