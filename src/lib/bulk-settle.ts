export type BulkItem = { id: string; label: string };

export type BulkOutcome = BulkItem & { ok: boolean; message?: string };

/**
 * Fan a destructive/restore action out across many selected rows by calling the
 * existing audited per-record endpoint once each, so every row keeps its own
 * ledger + audit trail. Never throws: a rejected fetch or a non-ok response is
 * reported per item so the caller can show a partial-failure summary and keep
 * the rows that did not succeed.
 */
export async function bulkSettle<T extends BulkItem>(
  items: T[],
  run: (item: T) => Promise<Response>,
): Promise<BulkOutcome[]> {
  return Promise.all(
    items.map(async (item): Promise<BulkOutcome> => {
      try {
        const res = await run(item);
        if (res.ok) return { id: item.id, label: item.label, ok: true };
        const payload = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        return {
          id: item.id,
          label: item.label,
          ok: false,
          message: payload?.error?.message ?? `Failed (${res.status}).`,
        };
      } catch (err) {
        return {
          id: item.id,
          label: item.label,
          ok: false,
          message: err instanceof Error ? err.message : 'Network error.',
        };
      }
    }),
  );
}
