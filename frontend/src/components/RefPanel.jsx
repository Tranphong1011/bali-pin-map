import { useEffect, useState } from 'react';
import { api } from '../api';
import { distClass, fmtKm, nearestTo } from '../geo';
import { refColor, refScore } from '../reference';

export default function RefPanel({ refId, summary, pins, onClose, onPin, onUnpin, onOpenImage }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setError('');
    api.referenceDetail(refId)
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [refId]);

  const p = detail || summary;
  if (!p) return null;
  const pinned = pins.find((x) => x.ref_place === p.id);
  const near = nearestTo({ ...p, id: -1 }, 1, pins)[0];
  const media = detail?.media || [];
  const photos = media.filter((m) => m.type === 'photo');

  return (
    <aside className="ref-panel">
      <div className="ref-head">
        <div className="ref-title">
          <span className="ref-dot" style={{ background: refColor(refScore(p)) }} />
          <div>
            <h3>{p.name}</h3>
            <div className="ref-meta">
              <span className="stars">★ {p.rating.toFixed(1)}</span>
              <span>{p.review_count.toLocaleString('en')} reviews</span>
              {p.category && <span>· {p.category}</span>}
              <span>· {p.area === 'penida' ? 'Nusa Penida' : 'Bali'}</span>
            </div>
          </div>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} title="Close">×</button>
      </div>

      {detail?.address && <p className="d-addr">{detail.address}</p>}

      <div className="ref-actions">
        {pinned ? (
          <button type="button" className="btn sm" onClick={() => onUnpin(pinned)}>✓ Pinned · Unpin</button>
        ) : (
          <button type="button" className="btn primary sm" onClick={() => onPin(detail || p)}>📌 Pin this place</button>
        )}
        {detail && <a className="btn ghost sm" href={detail.maps_url} target="_blank" rel="noopener noreferrer">🗺️ Open in Google Maps</a>}
      </div>
      {near && (
        <p className="ref-near">
          <span className={distClass(near.d)}>{fmtKm(near.d)}</span> from your pin “{near.place.name}”
        </p>
      )}

      <div className="ref-gallery">
        {!detail && !error && [0, 1, 2].map((i) => <div key={i} className="ref-media skeleton" />)}
        {error && <p className="muted pad">Could not load photos: {error}</p>}
        {detail && !media.length && <p className="muted pad">No photos were scraped for this place.</p>}
        {media.map((m, i) => (m.type === 'video' ? (
          <a key={i} className="ref-media video" href={m.link} target="_blank" rel="noopener noreferrer"
            title="Play this video on Google Maps">
            <img src={m.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" />
            <span className="play">▶</span>
            <span className="badge">{m.duration ? `Video · ${m.duration}` : 'Video'}{m.source === 'review' ? ' · from a review' : ''}</span>
          </a>
        ) : (
          <figure key={i} className="ref-media" onClick={() => onOpenImage(
            photos.map((x) => ({ ...x, title: p.name, page: detail.maps_url, src: 'Google Maps' })),
            photos.indexOf(m),
          )}>
            <img src={m.thumb} alt={p.name} loading="lazy" referrerPolicy="no-referrer"
              onError={(e) => { e.currentTarget.closest('figure').style.display = 'none'; }} />
            {m.source === 'review' && <span className="badge">From a review{m.author ? ` by ${m.author}` : ''}</span>}
          </figure>
        )))}
      </div>
      {media.length > 0 && <p className="hint pad-x">Photos &amp; videos from Google Maps (place gallery + reviews).</p>}
    </aside>
  );
}
