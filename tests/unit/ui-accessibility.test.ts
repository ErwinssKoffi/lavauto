// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Input, Modal, Select, Textarea } from '../../src/components/ui';

let container: HTMLDivElement;
let root: Root;
declare global { var IS_REACT_ACT_ENVIRONMENT: boolean }

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('libellés et identification des formulaires', () => {
  it('associe chaque libellé à son champ, avec un identifiant unique ou explicite', async () => {
    await act(async () => {
      root.render(React.createElement('div', null,
        React.createElement(Input, { label: 'Nom' }),
        React.createElement(Input, { label: 'Nom' }),
        React.createElement(Select, { label: 'Rôle', id: 'role-explicite' }, React.createElement('option', { value: 'laveur' }, 'Laveur')),
        React.createElement(Textarea, { label: 'Notes' }),
      ));
    });
    const labels = [...container.querySelectorAll('label')];
    expect(labels.map((label) => label.control?.tagName)).toEqual(['INPUT', 'INPUT', 'SELECT', 'TEXTAREA']);
    const ids = labels.map((label) => label.htmlFor);
    expect(new Set(ids).size).toBe(4);
    expect(ids[2]).toBe('role-explicite');
  });

  it('expose le titre de la fenêtre comme nom de dialogue', async () => {
    const close = vi.fn();
    await act(async () => {
      root.render(React.createElement(Modal, { open: true, title: 'Ouvrir la caisse', onClose: close, children: 'Contenu' }));
    });
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    const title = container.querySelector('h3');
    expect(dialog?.getAttribute('aria-labelledby')).toBe(title?.id);
    expect(title?.textContent).toBe('Ouvrir la caisse');
    await act(async () => { (dialog?.querySelector('button[aria-label="Fermer"]') as HTMLButtonElement).click(); });
    expect(close).toHaveBeenCalledOnce();
  });
});
