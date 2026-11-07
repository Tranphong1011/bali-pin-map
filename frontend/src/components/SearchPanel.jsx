import { useState } from 'react';
import { distClass, distKm, fmtKm, nearestTo } from '../geo';
import { searchPlaces } from '../search';

export default function SearchPanel({ pins, groups, activeGroup, onActiveGroup, activeColor, onPreview, onPin }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);
  const [message, setMessage] = useState('');
  const [active, setActive] = useState(0);

  const preview = (list, i) => {
    setActive(i);
    onPreview(list[i] || null);
  };

  const close = () => {
    setResults(null);
    setMessage('');
    onPreview(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    setMessage('');
    setResults([]);
    try {
      const res = await searchPlaces(q);
      setResults(res.results);
      setMessage(res.message || (res.results.length ? '' : 'Nothing found. Try another English/Indonesian name, '
        + 'or paste coordinates / a Google Maps link. You can also right-click the map to pin a spot directly.'));
      preview(res.results, 0);
    } catch (err) {
      setMessage(`Search failed (${err.message}). Check your connection and try again.`);
    } finally {
      setBusy(false);
    }
  };

  const pin = async (r) => {
    if (await onPin(r)) {
      close();
      setQ('');
    }
  };

  return (
    <>
      <form className="search" autoComplete="off" onSubmit={submit}>
        <div className="search-box">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search: Tanah Lot, Ubud, Kelingking…" />
          <button type="submit" className="btn primary" disabled={busy}>{busy ? '…' : 'Search'}</button>
        </div>
        <div className="pin-to">
          <span>Pin to group</span>
          <span className="dot" style={{ background: activeColor }} />
          <select value={activeGroup} onChange={(e) => onActiveGroup(e.target.value)}>
            <option value="none">Ungrouped</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
      </form>

      {(results || message) && (
        <div className="results">
          {busy && <div className="pad muted">Searching…</div>}
          {message && <div className="pad muted">{message}</div>}
          {results?.length > 0 && (
            <>
              <div className="res-head">
                <span>{results.length} result{results.length > 1 ? 's' : ''} · click to preview on map</span>
                <button type="button" className="link" onClick={close}>Close</button>
              </div>
              {results.map((r, i) => {
                const n = nearestTo(r, 1, pins)[0];
                const pinned = pins.some((p) => distKm(p, r) < 0.05);
                return (
                  <div key={i} className={'res' + (i === active ? ' active' : '')} onClick={() => preview(results, i)}>
                    <div className="res-main">
                      <b>{r.name}</b>
                      <small>{r.address}</small>
                      {n && (
                        <small className="near-info">
                          <span className={distClass(n.d)}>{fmtKm(n.d)}</span> from “{n.place.name}”
                        </small>
                      )}
                    </div>
                    {pinned ? <span className="tag">Pinned</span> : (
                      <button type="button" className="btn primary sm"
                        onClick={(e) => { e.stopPropagation(); pin(r); }}>📌 Pin</button>
                    )}
                  </div>
                );
              })}
            </>
          )}
          {!busy && !results?.length && message && (
            <div className="res-head"><span /><button type="button" className="link" onClick={close}>Close</button></div>
          )}
        </div>
      )}
    </>
  );
}
