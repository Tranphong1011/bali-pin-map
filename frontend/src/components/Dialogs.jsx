import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

export const PALETTE = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#0ea5e9', '#6366f1', '#a855f7', '#ec4899', '#78716c'];

function Modal({ children, onClose }) {
  const ref = useRef();
  useEffect(() => {
    const d = ref.current;
    d.showModal();
    return () => d.open && d.close();
  }, []);
  return (
    <dialog ref={ref} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      {children}
    </dialog>
  );
}

export function GroupDialog({ group, usedColors, onSave, onDelete, onClose }) {
  const [name, setName] = useState(group?.name || '');
  const [color, setColor] = useState(group?.color || PALETTE.find((c) => !usedColors.includes(c)) || PALETTE[0]);
  return (
    <Modal onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSave({ name: name.trim(), color }); }}>
        <h3>{group ? 'Edit group' : 'New group'}</h3>
        <label className="field">
          <span>Group name</span>
          <input autoFocus required maxLength={80} value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Day 1 – Ubud" />
        </label>
        <div className="field">
          <span>Color</span>
          <div className="swatches">
            {PALETTE.map((c) => (
              <button key={c} type="button" className={'sw' + (c === color ? ' on' : '')} style={{ background: c }}
                title={c} onClick={() => setColor(c)} />
            ))}
            <input type="color" value={color} title="Pick another color" onChange={(e) => setColor(e.target.value)} />
          </div>
        </div>
        <div className="dlg-actions">
          {group && <button type="button" className="btn danger-text" onClick={() => onDelete(group)}>Delete group</button>}
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">Save</button>
        </div>
      </form>
    </Modal>
  );
}

export function PasswordDialog({ onDone }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (await api.login(pw)) onDone(pw);
      else setError('Wrong password.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal onClose={() => onDone(null)}>
      <form onSubmit={submit}>
        <h3>🔒 Password</h3>
        <p className="muted">Anyone with the link can view the map. Pinning, unpinning and editing need the password
          (set as <code>APP_PASSWORD</code> on the server). It's remembered on this device.</p>
        <label className="field">
          <span>Password</span>
          <input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>
        {error && <p className="danger-text small">{error}</p>}
        <div className="dlg-actions">
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={() => onDone(null)}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>Unlock</button>
        </div>
      </form>
    </Modal>
  );
}

export function Lightbox({ items, index, onClose }) {
  const [i, setI] = useState(index);
  const step = (d) => setI((x) => (x + d + items.length) % items.length);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });
  const im = items[i];
  if (!im) return null;
  return (
    <div className="lightbox" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <button type="button" className="lb-close" onClick={onClose} title="Close">×</button>
      {items.length > 1 && <button type="button" className="lb-nav" onClick={() => step(-1)} title="Previous">‹</button>}
      <figure>
        <img src={im.full || im.thumb} alt="" referrerPolicy="no-referrer" />
        <figcaption>
          {im.title} · {i + 1}/{items.length}
          {im.page && <> · <a href={im.page} target="_blank" rel="noopener noreferrer">Source ({im.src || 'link'})</a></>}
        </figcaption>
      </figure>
      {items.length > 1 && <button type="button" className="lb-nav" onClick={() => step(1)} title="Next">›</button>}
    </div>
  );
}
