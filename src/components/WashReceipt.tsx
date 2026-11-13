import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { FiDownload, FiPrinter } from 'react-icons/fi';
import type { WashReceipt } from '../lib/receipt';
import { formatDateTime, formatFCFA } from '../lib/format';
import { downloadReceiptPdf } from '../lib/receiptPdf';
import { Alert, Modal } from './ui';

function ReceiptView({ receipt }: { receipt: WashReceipt }) {
  return (
    <article className="wash-receipt-sheet" aria-label={`Reçu ${receipt.number}`}>
      <header className="wash-receipt-header">
        <div>
          <p className="wash-receipt-brand">{receipt.companyName || receipt.stationName}</p>
          {receipt.companyName && receipt.stationName !== receipt.companyName && <p>{receipt.stationName}</p>}
          <p>{[receipt.stationAddress, receipt.stationCity, receipt.stationPhone].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="wash-receipt-header-meta">
          <p className="wash-receipt-kicker">Reçu de lavage</p>
          <strong>{receipt.number}</strong>
          <p>Émis le {formatDateTime(receipt.issuedAt)} (heure locale)</p>
        </div>
      </header>
      {receipt.isCancelled && <p className="wash-receipt-warning">FICHE ANNULÉE — ce document reflète une fiche annulée.</p>}
      <section>
        <h4>Informations de la fiche</h4>
        <div className="wash-receipt-info">
          <p><span>Créée le</span><strong>{formatDateTime(receipt.createdAt)}</strong></p>
          <p><span>Statut</span><strong>{receipt.status}</strong></p>
          <p><span>Client</span><strong>{receipt.clientName || 'Non renseigné'}</strong></p>
          <p><span>Véhicule</span><strong>{receipt.vehicleLabel || 'Non renseigné'}{receipt.plate ? ` · ${receipt.plate}` : ''}</strong></p>
        </div>
      </section>
      <section>
        <h4>Prestations et montants</h4>
        <table className="wash-receipt-table">
          <thead><tr><th>Prestation</th><th>Prix figé</th><th>Qté</th><th>Montant</th></tr></thead>
          <tbody>{receipt.items.length === 0
            ? <tr><td colSpan={4}>Aucune prestation enregistrée.</td></tr>
            : receipt.items.map((item, index) => <tr key={index}><td>{item.name}</td><td>{formatFCFA(item.unitPrice)}</td><td>{item.quantity}</td><td>{formatFCFA(item.amount)}</td></tr>)}</tbody>
        </table>
        <div className="wash-receipt-totals">
          <p><span>Sous-total</span><strong>{formatFCFA(receipt.subtotal)}</strong></p>
          <p><span>Remise totale</span><strong>− {formatFCFA(receipt.discount)}</strong></p>
          <p><span>Total enregistré</span><strong>{formatFCFA(receipt.total)}</strong></p>
          <p><span>Encaissé net enregistré</span><strong>{formatFCFA(receipt.paid)}</strong></p>
          <p className="wash-receipt-balance"><span>{receipt.isCancelled ? 'Reste indicatif sur fiche annulée' : 'Reste à payer'}</span><strong>{formatFCFA(receipt.balance)}</strong></p>
        </div>
      </section>
      <section>
        <h4>Encaissements</h4>
        {receipt.payments.length === 0 ? <p>Aucun encaissement enregistré.</p> : (
          <table className="wash-receipt-table">
            <thead><tr><th>Moyen</th><th>Date</th><th>État</th><th>Montant</th></tr></thead>
            <tbody>{receipt.payments.map((payment) => <tr key={payment.id}>
              <td>{payment.method}</td><td>{formatDateTime(payment.at)}</td>
              <td>{payment.cancelled ? `Annulé / remboursé${payment.cancelledAt ? ` le ${formatDateTime(payment.cancelledAt)}` : ''}` : 'Enregistré'}</td>
              <td>{formatFCFA(payment.amount)}</td>
            </tr>)}</tbody>
          </table>
        )}
      </section>
      {receipt.inconsistencies.length > 0 && <section className="wash-receipt-warning"><h4>Vérification nécessaire</h4>{receipt.inconsistencies.map((warning) => <p key={warning}>{warning}</p>)}</section>}
      <footer>Récapitulatif à la date d’émission ; les annulations ultérieures ne sont pas reflétées. Ce document n’est pas une facture fiscale.</footer>
    </article>
  );
}

export function WashReceiptModal({ receipt, onClose }: { receipt: WashReceipt; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { await downloadReceiptPdf(receipt); }
    catch (e) { setError(e instanceof Error ? e.message : 'Téléchargement du PDF impossible.'); }
    finally { setBusy(false); }
  };
  return <>
    <Modal open onClose={onClose} title={`Reçu ${receipt.number}`} wide>
      <p className="text-base-content/60 mb-3 text-xs">Instantané de la fiche chargée. Actualisez les lavages avant d’émettre un nouveau reçu si une opération vient d’être enregistrée ailleurs.</p>
      {error && <div className="mb-3"><Alert kind="danger">{error}</Alert></div>}
      <ReceiptView receipt={receipt} />
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button className="btn btn-sm" onClick={() => window.print()}><FiPrinter /> Imprimer</button>
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => { void save(); }}><FiDownload /> {busy ? 'Préparation…' : 'Télécharger le PDF'}</button>
      </div>
    </Modal>
    {createPortal(<div className="wash-receipt-print-root"><ReceiptView receipt={receipt} /></div>, document.body)}
  </>;
}
