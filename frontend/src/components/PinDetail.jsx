import { useEffect, useRef, useState } from 'react';
import { dirUrl, distClass, distKm, fmtKm, gmapsUrl } from '../geo';
import { gimagesUrl } from '../images';

export default function PinDetail({ pin, index, total, groups, groupOf, pins, imagesLoading, onBack, onStep, onUpdate,
  onUnpin, onMoreImages, onAddImage, onRemoveImage, onOpenImage, onSelect, toast }) {
  const g = groupOf(pin);
  const [name, setName] = useState(pin.name);
  const [note, setNote] = useState(pin.note);
  const noteTimer = useRef();

  useEffect(() => { setName(pin.name); setNote(pin.note); }, [pin.id, pin.name, pin.note]);

  const others = pins.filter((o) => o.id !== pin.id).map((o) => ({ o, d: distKm(pin, o) })).sort((a, b) => a.d - b.d);
  const imgs = pin.images || [];
  const srcs = [...new Set(imgs.map((im) => im.src))].join(', ');

  const changeNote = (v) => {
    setNote(v);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => onUpdate(pin, { note: v }), 600);
  };

  const commitName = () => {
    const v = name.trim();
    if (!v) setName(pin.name);
    else if (v !== pin.name) onUpdate(pin, { name: v });
  };

  return (
    <div className="detail">
      <div className="d-bar">
        <button type="button" className="btn ghost sm" onClick={onBack}>← List</button>
        <span className="d-pos">{index}/{total}</span>
        <div>
          <button type="button" className="btn ghost sm" onClick={() => onStep(-1)} title="Previous place">‹</button>
          <button type="button" className="btn ghost sm" onClick={() => onStep(1)} title="Next place">›</button>
        </div>
      </div>

      <div className="d-title">
        <span className="num lg" style={{ background: g.color }}>{index}</span>
        <input className="d-name" value={name} title="Click to rename" onChange={(e) => setName(e.target.value)}
          onBlur={commitName} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
      </div>
      {pin.address && <p className="d-addr">{pin.address}</p>}

      <div className="d-group">
        <span className="dot" style={{ background: g.color }} />
        <select value={pin.group ?? 'none'} title="Change group"
          onChange={(e) => onUpdate(pin, { group: e.target.value === 'none' ? null : +e.target.value })}>
          <option value="none">Ungrouped</option>
          {groups.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </div>

      <div className="imgs">
        {imagesLoading && !imgs.length && [0, 1, 2].map((i) => <figure key={i} className="skeleton" />)}
        {!imagesLoading && !imgs.length && (
          <div className="img-empty">No photos found automatically.<br />
            Click “Google Images” to browse, then “+ Add photo” to paste an image link.</div>
        )}
        {imgs.map((im, i) => (
          <figure key={im.full + i} title={im.title || pin.name} onClick={() => onOpenImage(imgs, i)}>
            <img src={im.thumb} alt={im.title || pin.name} loading="lazy" referrerPolicy="no-referrer"
              onError={(e) => { e.currentTarget.closest('figure').style.opacity = 0.3; }} />
            <button type="button" className="img-x" title="Remove this photo"
              onClick={(e) => { e.stopPropagation(); onRemoveImage(pin, i); }}>×</button>
          </figure>
        ))}
      </div>
      <div className="img-tools">
        <button type="button" className="btn ghost sm" disabled={imagesLoading} onClick={() => onMoreImages(pin)}>
          {imagesLoading ? '⏳ Loading…' : '↻ Other photos'}
        </button>
        <button type="button" className="btn ghost sm" onClick={() => onAddImage(pin)}>+ Add photo</button>
        {srcs && <span className="img-src">Source: {srcs}</span>}
      </div>

      <div className="d-links">
        <a className="btn ghost sm" target="_blank" rel="noopener noreferrer" href={gmapsUrl(pin)}>🗺️ Google Maps</a>
        <a className="btn ghost sm" target="_blank" rel="noopener noreferrer" href={gimagesUrl(pin)}>🖼️ Google Images</a>
        <button type="button" className="btn ghost sm" title="Copy coordinates"
          onClick={() => navigator.clipboard?.writeText(`${pin.lat.toFixed(6)}, ${pin.lng.toFixed(6)}`).then(() => toast('Coordinates copied'))}>
          📋 {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
        </button>
      </div>

      <label className="field">
        <span>Notes</span>
        <textarea rows={3} value={note} placeholder="Opening hours, ticket price, what to eat…"
          onChange={(e) => changeNote(e.target.value)} />
      </label>

      <div className="sec-head" style={{ marginTop: 14 }}><h2>Distance to other places</h2></div>
      <div className="legend">
        <span className="near">● &lt; 5 km</span><span className="mid">● 5–15 km</span><span className="far">● &gt; 15 km</span>
        <span className="muted">(straight line)</span>
      </div>
      <ul className="dist-list">
        {others.length ? others.map(({ o, d }) => (
          <li key={o.id} onClick={() => onSelect(o.id)}>
            <span className="dot" style={{ background: groupOf(o).color }} />
            <span className="nm">{o.name}</span>
            <b className={distClass(d)}>{fmtKm(d)}</b>
            <a href={dirUrl(pin, o)} target="_blank" rel="noopener noreferrer" title="Google Maps directions"
              onClick={(e) => e.stopPropagation()}>🚗</a>
          </li>
        )) : <li className="muted">Pin more places to compare distances.</li>}
      </ul>
      <p className="hint">Tip: drag the selected pin on the map to fine-tune its position.</p>
      <button type="button" className="btn danger-text full" style={{ marginTop: 10 }} onClick={() => onUnpin(pin)}>
        📍✕ Unpin this place
      </button>
    </div>
  );
}
