import { Link } from 'react-router-dom';
import { FiChevronRight } from 'react-icons/fi';

export interface Crumb { label: string; to?: string }

/** Fil d'Ariane réel, construit depuis la configuration de navigation. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Fil d'Ariane" className="hidden min-w-0 items-center gap-1 text-xs sm:flex">
      {items.map((crumb, index) => {
        const last = index === items.length - 1;
        return (
          <span key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1">
            {index > 0 && <FiChevronRight className="shrink-0 text-base-content/60" size={13} aria-hidden="true" />}
            {crumb.to && !last ? (
              <Link to={crumb.to} className="link link-primary truncate">{crumb.label}</Link>
            ) : (
              <span className={`truncate ${last ? 'font-bold' : 'text-base-content/60'}`} aria-current={last ? 'page' : undefined}>{crumb.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
