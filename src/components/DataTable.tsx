import { useMemo, useState, type ReactNode } from 'react';
import { FiArrowDown, FiArrowUp, FiSearch } from 'react-icons/fi';
import { EmptyState } from './ui';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Fourni uniquement pour les colonnes réellement triables. */
  sortValue?: (row: T) => string | number;
  align?: 'left' | 'right';
}

interface SortState { key: string; direction: 'asc' | 'desc' }

/** Tableau réel : recherche locale, tri accessible (aria-sort), état vide
 *  explicite, aucune donnée factice, lignes identifiées par `rowKey`. */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  searchText,
  searchPlaceholder = 'Rechercher…',
  emptyTitle,
  emptyDescription,
  footer,
  initialSort,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  emptyTitle: string;
  emptyDescription?: string;
  footer?: ReactNode;
  initialSort?: string;
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState | null>(initialSort ? { key: initialSort, direction: 'asc' } : null);
  const normalise = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  const visible = useMemo(() => {
    const q = normalise(query.trim());
    const filtered = q && searchText ? rows.filter((row) => normalise(searchText(row)).includes(q)) : rows;
    const column = sort ? columns.find((c) => c.key === sort.key && c.sortValue) : undefined;
    if (!sort || !column?.sortValue) return filtered;
    const getter = column.sortValue;
    const sorted = [...filtered].sort((a, b) => {
      const left = getter(a);
      const right = getter(b);
      const compared = typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right), 'fr');
      return sort.direction === 'asc' ? compared : -compared;
    });
    return sorted;
  }, [rows, columns, query, sort, searchText]);

  const toggleSort = (column: Column<T>) => {
    if (!column.sortValue) return;
    setSort((current) => current?.key === column.key
      ? { key: column.key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      : { key: column.key, direction: 'asc' });
  };

  return (
    <div>
      {searchText && (
        <div className="relative mb-3">
          <FiSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base-content/60" aria-hidden="true" />
          <input
            type="search"
            className="input input-bordered input-sm w-full !pl-9"
            aria-label={searchPlaceholder}
            placeholder={searchPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      )}
      {visible.length === 0 ? (
        <EmptyState title={query ? 'Aucun résultat pour cette recherche' : emptyTitle} description={query ? 'Essayez un autre terme.' : emptyDescription} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-base-300">
          <table className="table min-w-[620px]">
            <thead className="uppercase tracking-wider">
              <tr>
                {columns.map((column) => {
                  const active = sort?.key === column.key;
                  const ariaSort = active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none';
                  return (
                    <th
                      key={column.key}
                     
                      aria-sort={column.sortValue ? ariaSort : undefined}
                      style={column.align === 'right' ? { textAlign: 'right' } : undefined}
                    >
                      {column.sortValue ? (
                        <button type="button" className="inline-flex items-center gap-1 hover:text-sky-400" onClick={() => toggleSort(column)}>
                          {column.header}
                          {active && (sort.direction === 'asc' ? <FiArrowUp size={11} aria-hidden="true" /> : <FiArrowDown size={11} aria-hidden="true" />)}
                        </button>
                      ) : column.header}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={rowKey(row)}>
                  {columns.map((column) => (
                    <td key={column.key} style={column.align === 'right' ? { textAlign: 'right' } : undefined}>
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {footer && <tfoot>{footer}</tfoot>}
          </table>
        </div>
      )}
    </div>
  );
}
