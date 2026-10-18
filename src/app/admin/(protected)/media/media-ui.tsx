/** Small pieces shared by the media pages. */

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
