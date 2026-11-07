import { distClass, fmtKm, nearestTo } from '../geo';

export function GroupChips({ groups, ungrouped, counts, isHidden, onToggle, onSolo, onShowAll, onEdit, onAdd }) {
  const all = [ungrouped, ...groups];
  return (
    <section>
      <div className="sec-head">
        <h2>Color groups</h2>
        <button type="button" className="btn ghost sm" onClick={onAdd}>+ New group</button>
      </div>
      <div className="chips">
        {all.map((g) => (
          <div key={g.id ?? 'none'} className={'chip' + (isHidden(g) ? ' off' : '')} style={{ '--c': g.color }}
            onClick={() => onToggle(g)} onDoubleClick={() => onSolo(g)} title="Click to show/hide · double-click to show only this">
            <span className="dot" />
            <span className="chip-name">{g.name}</span>
            <span className="chip-count">{counts[g.id ?? 'none'] || 0}</span>
            {g.id != null && (
              <button type="button" className="chip-edit" title="Rename / recolor"
                onClick={(e) => { e.stopPropagation(); onEdit(g); }}>✎</button>
            )}
          </div>
        ))}
        {all.some(isHidden) && <button type="button" className="chip plain" onClick={onShowAll}>Show all</button>}
      </div>
      <p className="hint">Click to show/hide · double-click to show only that group · ✎ to rename/recolor</p>
    </section>
  );
}

export default function PinList({ pins, groups, ungrouped, groupOf, isHidden, selectedPinId, onSelect, onUnpin,
  showLabels, onShowLabels, onFit }) {
  const index = new Map(pins.map((p, i) => [p.id, i + 1]));
  return (
    <section>
      <div className="sec-head">
        <h2>Pinned places <span className="count">{pins.length}</span></h2>
        <div className="sec-tools">
          <label className="toggle">
            <input type="checkbox" checked={showLabels} onChange={(e) => onShowLabels(e.target.checked)} /> Labels
          </label>
          <button type="button" className="btn ghost sm" onClick={onFit}>Show all</button>
        </div>
      </div>

      {!pins.length && (
        <div className="empty-state">
          <div className="big">🗺️</div>
          No places yet.<br />
          Type a name in the search box (e.g. <b>Tanah Lot</b>, <b>Tegallalang</b>, <b>Kelingking Beach</b>) and click <b>📌 Pin</b>.<br />
          <span className="small">Tip: right-click (or long-press) the map to pin any spot, or turn on ⭐ Reference to see popular places.</span>
        </div>
      )}

      {[ungrouped, ...groups].map((g) => {
        const items = pins.filter((p) => groupOf(p) === g);
        if (!items.length) return null;
        return (
          <div key={g.id ?? 'none'} className={'grp' + (isHidden(g) ? ' off' : '')}>
            <div className="grp-h"><span className="dot" style={{ background: g.color }} />{g.name} <small>{items.length}</small></div>
            {items.map((p) => {
              const n = nearestTo(p, 1, pins)[0];
              const img = p.images?.[0];
              return (
                <div key={p.id} className={'item' + (p.id === selectedPinId ? ' sel' : '')} onClick={() => onSelect(p.id)}>
                  <span className="num" style={{ background: g.color }}>{index.get(p.id)}</span>
                  {img
                    ? <img className="thumb" src={img.thumb} alt="" loading="lazy" referrerPolicy="no-referrer"
                        onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                    : <span className="thumb empty">📍</span>}
                  <div className="item-main">
                    <b>{p.name}</b>
                    <small>
                      {n ? <>Nearest: {n.place.name} · <span className={distClass(n.d)}>{fmtKm(n.d)}</span></>
                        : (p.address || '').split(',').slice(1, 3).join(',')}
                    </small>
                  </div>
                  <button type="button" className="unpin-x" title="Unpin"
                    onClick={(e) => { e.stopPropagation(); onUnpin(p); }}>✕</button>
                </div>
              );
            })}
          </div>
        );
      })}
    </section>
  );
}
