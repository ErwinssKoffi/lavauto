import { Component, type ReactNode } from 'react';
import { FiAlertTriangle, FiRefreshCw } from 'react-icons/fi';
import { Card } from './ui';

/** Placeholder de chargement (squelette), sans donnée factice. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton ${className}`} />;
}

/** État de chargement réel : utilisé par la garde de session. */
export function LoadingState({ label = 'Chargement…', className = '' }: { label?: string; className?: string }) {
  return (
    <div className={`grid min-h-screen place-items-center ${className}`} role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3">
        <span className="h-10 w-10 animate-pulse rounded-xl bg-linear-to-br from-primary via-primary to-secondary" aria-hidden="true" />
        <p className="text-xs text-base-content/60">{label}</p>
      </div>
    </div>
  );
}

/** État d'erreur avec action de reprise explicite. */
export function ErrorState({
  title = 'Une erreur est survenue',
  description = 'L’écran n’a pas pu être affiché. Vos données enregistrées ne sont pas modifiées.',
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="mx-auto max-w-lg">
      <Card className="text-center">
        <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl bg-warning/15 text-warning">
          <FiAlertTriangle aria-hidden="true" />
        </div>
        <h2 className="text-base font-bold">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-base-content/60">{description}</p>
        {onRetry && (
          <button type="button" className="btn btn-sm btn-primary mt-5" onClick={onRetry}>
            <FiRefreshCw aria-hidden="true" /> Réessayer
          </button>
        )}
      </Card>
    </div>
  );
}

interface ErrorBoundaryProps { children: ReactNode; fallback?: ReactNode }
interface ErrorBoundaryState { hasError: boolean }

/** Barrière d'erreur de rendu : un composant en faute n'efface pas
 *  l'application entière et n'affiche jamais de fausses données. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(): void {
    // Volontairement silencieux : la journalisation serveur est prévue à
    // l'étape 04 (audit_logs). On n'écrit rien dans localStorage ici.
  }

  private retry = () => this.setState({ hasError: false });

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="p-6">
          <ErrorState onRetry={this.retry} />
        </div>
      );
    }
    return this.props.children;
  }
}
