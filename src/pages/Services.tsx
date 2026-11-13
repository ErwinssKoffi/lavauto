import React, { useState } from 'react';
import { FiCheckCircle, FiEdit3, FiPlus, FiTrash2, FiX } from 'react-icons/fi';
import { useStore } from '../lib/store';
import { formatFCFA } from '../lib/format';
import { Alert, Badge, Card, Input, Modal, PageHeader, useSafeAction } from '../components/ui';
import { PriceInput } from '../components/PriceInput';

export default function Services() {
  const { state, canWriteSubscription, addService, updateService, removeService, notify } = useStore();
  const safe = useSafeAction();
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const cats = state.vehicleCategories.filter((c) => c.active);
  const edit = state.services.find((s) => s.id === editId);

  return (
    <div>
      <PageHeader title="Prestations" subtitle="Catalogue propre à la station. Modifier un tarif ne change jamais les lavages déjà enregistrés."
        actions={<button className="btn btn-sm btn-primary" disabled={!canWriteSubscription} onClick={() => setAddOpen(true)}><FiPlus /> Nouvelle prestation</button>} />

      <div className="mb-5"><Alert kind="info">Le tarif est enregistré lorsque vous quittez la case ou appuyez sur Entrée. Les prix sont figés sur chaque fiche au moment de sa création : l’historique et les rapports restent justes.</Alert></div>

      <Card className="mb-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold">Grille tarifaire</h2>
          <Badge tone="accent">{state.services.filter((s) => s.active).length} prestation(s) · {cats.length} catégorie(s)</Badge>
        </div>
        {cats.length === 0 || state.services.length === 0 ? (
          <p className="text-base-content/60 text-xs">Ajoutez au moins une catégorie de véhicules (Mise en route) et une prestation pour afficher la grille.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="table min-w-[620px]">
              <thead><tr><th>Prestation</th>{cats.map((c) => <th key={c.id}>{c.name}</th>)}<th>État</th></tr></thead>
              <tbody>
                {state.services.map((s) => (
                  <tr key={s.id}>
                    <td><p className="font-medium">{s.name}</p>{s.description && <p className="text-base-content/60 text-xs">{s.description}</p>}</td>
                    {cats.map((c) => (
                      <td key={c.id}>
                        <PriceInput serviceId={s.id} categoryId={c.id} value={s.prices[c.id]} label={`Prix ${s.name} pour ${c.name}`} />
                      </td>
                    ))}
                    <td><Badge tone={s.active ? 'success' : 'neutral'}>{s.active ? 'Active' : 'Désactivée'}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-base-content/60 mt-3 text-xs">Montants en FCFA. Un prix vide rend la prestation indisponible à la saisie d’une fiche.</p>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {state.services.length === 0 && <Card className="sm:col-span-2 lg:col-span-3"><p className="text-base-content/60 py-6 text-center text-xs">Aucune prestation enregistrée. Aucune donnée d’exemple n’est ajoutée.</p></Card>}
        {state.services.map((s) => (
          <Card key={s.id} className="flex flex-col">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><h3 className="text-sm font-bold">{s.name}</h3><p className="text-base-content/60 mt-1 text-xs">{s.description || 'Aucune description'}</p></div>
              <Badge tone={s.active ? 'success' : 'neutral'}>{s.active ? 'Active' : 'Désactivée'}</Badge>
            </div>
            <p className="text-base-content/60 mt-4 text-[11px]">Prix enregistrés</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {cats.map((c) => <span key={c.id} className="badge badge-sm">{c.name} : {s.prices[c.id] ? formatFCFA(s.prices[c.id]) : '—'}</span>)}
              {cats.length === 0 && <span className="text-base-content/60 text-xs">Aucune catégorie</span>}
            </div>
            <div className="mt-4 flex flex-wrap gap-2 border-t pt-3">
              <button className="btn btn-sm px-2.5! py-1.5! text-xs" disabled={!canWriteSubscription} onClick={() => { setEditId(s.id); setEditName(s.name); setEditDesc(s.description); }}><FiEdit3 /> Modifier</button>
              <button className="btn btn-sm px-2.5! py-1.5! text-xs" disabled={!canWriteSubscription} onClick={() => { void safe(() => updateService(s.id, { active: !s.active })); }}>{s.active ? 'Désactiver' : 'Activer'}</button>
              <button className="text-base-content/60 ml-auto hover:text-error" disabled={!canWriteSubscription} onClick={() => { void safe(async () => { await removeService(s.id); notify('info', 'Prestation retirée du catalogue.'); }); }} aria-label="Supprimer"><FiTrash2 size={15} /></button>
            </div>
          </Card>
        ))}
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Nouvelle prestation">
        <Input label="Nom de la prestation *" disabled={!canWriteSubscription} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Lavage complet" />
        <Input label="Description (facultative)" disabled={!canWriteSubscription} className="mt-3" value={desc} onChange={(e) => setDesc(e.target.value)} />
        <p className="text-base-content/60 mt-3 text-xs">Le prix sera saisi dans la grille tarifaire ci-dessus, pour chaque catégorie de véhicules. Aucun montant n’est suggéré.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-sm" onClick={() => setAddOpen(false)}><FiX /> Annuler</button>
          <button className="btn btn-sm btn-primary" disabled={!canWriteSubscription} onClick={() => { if (!name.trim()) return; void safe(async () => { await addService(name, desc); setName(''); setDesc(''); setAddOpen(false); notify('success', 'Prestation ajoutée.'); }); }}><FiPlus /> Ajouter</button>
        </div>
      </Modal>

      <Modal open={Boolean(edit)} onClose={() => setEditId(null)} title="Modifier la prestation">
        <Input label="Nom" disabled={!canWriteSubscription} value={editName} onChange={(e) => setEditName(e.target.value)} />
        <Input label="Description" disabled={!canWriteSubscription} className="mt-3" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-sm" onClick={() => setEditId(null)}>Annuler</button>
          <button className="btn btn-sm btn-primary" disabled={!canWriteSubscription} onClick={() => { if (!edit) return; void safe(async () => { await updateService(edit.id, { name: editName, description: editDesc }); setEditId(null); notify('success', 'Prestation modifiée.'); }); }}><FiCheckCircle /> Enregistrer</button>
        </div>
      </Modal>
    </div>
  );
}
