// Formatage FR : montants en FCFA (« 12 500 FCFA »), dates « jj/mm/aaaa ».

export function formatFCFA(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '0 FCFA';
  const rounded = Math.round(amount);
  const grouped = rounded.toLocaleString('fr-FR').replace(/\u202F/g, ' ');
  return `${grouped} FCFA`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString('fr-FR').replace(/\u202F/g, ' ');
}

/** '2026-11-11' ou ISO → '11/11/2026' */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  // « aaaa-mm-jj » est interprété en UTC par new Date(), ce qui décale d'un
  // jour à l'ouest de Greenwich. On construit la date explicitement en local.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${formatDate(value)} à ${hh}:${mi}`;
}

export function todayISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function isToday(iso: string): boolean {
  return iso.slice(0, 10) === todayISO();
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

/** Télécharge un CSV (BOM UTF-8 pour Excel FR). */
export function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (v: string | number) => {
    if (typeof v === 'number') return String(v);
    let s = String(v ?? '');
    // Anti-injection de formule Excel / LibreOffice sur les textes saisis
    // (noms de clients, motifs, fournisseurs…). Les nombres, y compris
    // négatifs, restent des nombres.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows].map((r) => r.map(escape).join(';')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
