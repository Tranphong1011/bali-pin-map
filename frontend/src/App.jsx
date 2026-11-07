import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, AuthError, getPassword, setPassword } from './api';
import { BALI_CENTER } from './geo';
import { findImages } from './images';
import { reverseGeocode } from './search';
import { BUCKETS, REF_GRADIENT, bucketOf } from './reference';
import MapView from './components/MapView';
import SearchPanel from './components/SearchPanel';
import PinList, { GroupChips } from './components/PinList';
import PinDetail from './components/PinDetail';
import RefPanel from './components/RefPanel';
import { GroupDialog, Lightbox, PasswordDialog } from './components/Dialogs';

const PREFS_KEY = 'baliPinMap.prefs';
const LEGACY_KEY = 'baliPinMap.v1';
const UNGROUPED = { id: null, name: 'Ungrouped', color: '#64748b' };
const DEFAULT_PREFS = {
  hiddenGroups: [], showLabels: true, baseLayer: 'Google Maps', activeGroup: 'none',
  refOn: false, refArea: 'all', refBucket: 'all',
};

const groupKey = (g) => String(g.id ?? 'none');

function loadPrefs() {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return DEFAULT_PREFS; }
}

function useToast() {
  const [msg, setMsg] = useState('');
  const timer = useRef();
  const toast = useCallback((m) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(''), 2800);
  }, []);
  return [msg, toast];
}

export default function App() {
  const [groups, setGroups] = useState([]);
  const [pins, setPins] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [authRequired, setAuthRequired] = useState(false);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [selectedPinId, setSelectedPinId] = useState(null);
  const [refPlaces, setRefPlaces] = useState(null);
  const [selectedRefId, setSelectedRefId] = useState(null);
  const [map, setMap] = useState(null);
  const [preview, setPreview] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const [groupDlg, setGroupDlg] = useState(null);
  const [pwPrompt, setPwPrompt] = useState(null);
  const [imagesLoading, setImagesLoading] = useState(() => new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const [legacyCount, setLegacyCount] = useState(0);
  const [toastMsg, toast] = useToast();
  const imgPage = useRef({});
  const fileInput = useRef();

  useEffect(() => { window.baliMap = map; }, [map]); // handy for debugging / browser tests

  const updatePrefs = (patch) => setPrefs((p) => ({ ...p, ...patch }));
  useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
  }, [prefs]);

  // ---------- loading ----------
  const reload = useCallback(async () => {
    try {
      const [g, p, a] = await Promise.all([api.groups(), api.pins(), api.authInfo()]);
      setGroups(g);
      setPins(p);
      setAuthRequired(a.required);
      setLoadError('');
      return p;
    } catch (e) {
      setLoadError(e.message);
      return null;
    }
  }, []);

  useEffect(() => {
    reload().then((p) => {
      try {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null');
        if (legacy?.places?.length && !localStorage.getItem(LEGACY_KEY + '.imported')) setLegacyCount(legacy.places.length);
      } catch { /* ignore */ }
      if (p?.length) setTimeout(() => fitPins(p), 300);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (prefs.refOn && refPlaces === null) {
      api.reference().then(setRefPlaces).catch((e) => toast('Could not load reference places: ' + e.message));
    }
  }, [prefs.refOn, refPlaces, toast]);

  // ---------- auth ----------
  const askPassword = () => new Promise((resolve) => setPwPrompt({ resolve }));
  const canWrite = !authRequired || !!getPassword();

  /** Runs a write; on 403 asks for the password and retries. Returns undefined on failure. */
  const guarded = useCallback(async (fn) => {
    for (;;) {
      try {
        return await fn();
      } catch (e) {
        if (!(e instanceof AuthError)) {
          toast('Error: ' + e.message);
          return undefined;
        }
        setPassword('');
        const pw = await askPassword();
        if (!pw) return undefined;
      }
    }
  }, [toast]);

  // ---------- groups ----------
  const groupOf = useCallback((p) => groups.find((g) => g.id === p.group) || UNGROUPED, [groups]);
  const isHidden = useCallback((g) => prefs.hiddenGroups.includes(groupKey(g)), [prefs.hiddenGroups]);
  const activeGroupObj = groups.find((g) => String(g.id) === prefs.activeGroup) || UNGROUPED;
  const counts = useMemo(() => {
    const c = {};
    pins.forEach((p) => { const k = groupKey(groupOf(p)); c[k] = (c[k] || 0) + 1; });
    return c;
  }, [pins, groupOf]);

  const showGroup = (g) => updatePrefs({ hiddenGroups: prefs.hiddenGroups.filter((k) => k !== groupKey(g)) });
  const toggleGroup = (g) => {
    const k = groupKey(g);
    updatePrefs({ hiddenGroups: isHidden(g) ? prefs.hiddenGroups.filter((x) => x !== k) : [...prefs.hiddenGroups, k] });
    const sel = pins.find((p) => p.id === selectedPinId);
    if (sel && groupOf(sel) === g && !isHidden(g)) setSelectedPinId(null);
  };
  const soloGroup = (g) => {
    updatePrefs({ hiddenGroups: [UNGROUPED, ...groups].map(groupKey).filter((k) => k !== groupKey(g)) });
    setSelectedPinId(null);
  };

  const saveGroup = async (data) => {
    const editing = groupDlg.group;
    const saved = await guarded(() => (editing ? api.updateGroup(editing.id, data) : api.createGroup({ ...data, order: groups.length })));
    if (!saved) return;
    setGroups((gs) => (editing ? gs.map((g) => (g.id === saved.id ? saved : g)) : [...gs, saved]));
    if (!editing) updatePrefs({ activeGroup: String(saved.id) }); // a new group becomes the pin target
    setGroupDlg(null);
  };

  const deleteGroup = async (g) => {
    const n = pins.filter((p) => p.group === g.id).length;
    if (!confirm(`Delete group “${g.name}”?${n ? ` ${n} place${n > 1 ? 's' : ''} will move to “Ungrouped”.` : ''}`)) return;
    if ((await guarded(() => api.deleteGroup(g.id))) === undefined) return;
    setGroups((gs) => gs.filter((x) => x.id !== g.id));
    setPins((ps) => ps.map((p) => (p.group === g.id ? { ...p, group: null } : p)));
    if (prefs.activeGroup === String(g.id)) updatePrefs({ activeGroup: 'none' });
    setGroupDlg(null);
  };

  // ---------- pins ----------
  const flyTo = (lat, lng, minZoom = 12) => map?.flyTo([lat, lng], Math.max(map.getZoom(), minZoom), { duration: 0.6 });

  const fitPins = (list = pins) => {
    if (!map) return;
    const pts = list.filter((p) => !isHidden(groupOf(p)));
    if (!pts.length) map.setView(BALI_CENTER, 10);
    else if (pts.length === 1) map.setView([pts[0].lat, pts[0].lng], 14);
    else map.fitBounds(pts.map((p) => [p.lat, p.lng]), { padding: [50, 50], maxZoom: 15 });
  };

  const setLoadingImg = (id, on) => setImagesLoading((s) => {
    const n = new Set(s);
    if (on) n.add(id); else n.delete(id);
    return n;
  });

  /** Updates local state immediately; saves to the server only if this viewer may write. */
  const updatePin = useCallback(async (pin, patch, { silent = false } = {}) => {
    setPins((ps) => ps.map((p) => (p.id === pin.id ? { ...p, ...patch } : p)));
    if (silent && !canWrite) return;
    const saved = await guarded(() => api.updatePin(pin.id, patch));
    if (!saved) reload();
  }, [canWrite, guarded, reload]);

  const loadImages = useCallback(async (pin, next = false) => {
    setLoadingImg(pin.id, true);
    const page = next ? (imgPage.current[pin.id] || 0) + 1 : 0;
    const { images, exhausted } = await findImages(pin, page);
    imgPage.current[pin.id] = page;
    if (next && exhausted) toast('No more photos — try “Google Images” or “+ Add photo”');
    setLoadingImg(pin.id, false);
    await updatePin(pin, { images, images_tried: true }, { silent: true });
  }, [toast, updatePin]);

  const selectPin = (id, fly = true) => {
    const p = pins.find((x) => x.id === id);
    setSelectedPinId(p ? id : null);
    if (!p) return;
    showGroup(groupOf(p));
    if (fly) flyTo(p.lat, p.lng);
    if (p.ref_place) setSelectedRefId(p.ref_place);
    if (!p.images?.length && !p.images_tried && !imagesLoading.has(p.id)) loadImages(p);
    document.querySelector('.scroll')?.scrollTo(0, 0);
  };

  const addPin = async (data) => {
    const group = prefs.activeGroup === 'none' ? null : +prefs.activeGroup;
    const created = await guarded(() => api.createPin({ ...data, group }));
    if (!created) return false;
    setPins((ps) => [...ps, created]);
    showGroup(activeGroupObj);
    setPreview(null);
    setSelectedPinId(created.id);
    flyTo(created.lat, created.lng);
    if (!created.images?.length) loadImages(created);
    toast(`📌 Pinned “${created.name}”`);
    return true;
  };

  const pinFromRef = (r) => addPin({
    name: r.name, address: r.address || '', region: 'Bali', lat: r.lat, lng: r.lng, ref_place: r.id,
    images: (r.media || []).filter((m) => m.type === 'photo').slice(0, 3)
      .map((m) => ({ thumb: m.thumb, full: m.full, page: r.maps_url, title: r.name, src: 'Google Maps' })),
    images_tried: true,
  });

  const pinHere = async ({ lat, lng }) => {
    const info = await reverseGeocode(lat, lng).catch(() => null);
    addPin({
      name: info?.name || `Location ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      address: info?.address || '', region: info?.region || '', lat, lng,
    });
  };

  const unpin = async (pin) => {
    if (!confirm(`Unpin “${pin.name}”?`)) return;
    if ((await guarded(() => api.deletePin(pin.id))) === undefined) return;
    setPins((ps) => ps.filter((p) => p.id !== pin.id));
    if (selectedPinId === pin.id) setSelectedPinId(null);
    toast(`Unpinned “${pin.name}”`);
  };

  const movePin = (pin, ll) => {
    updatePin(pin, { lat: ll.lat, lng: ll.lng });
    toast('Location updated');
  };

  const addImage = (pin) => {
    const url = prompt('Paste an image link (URL).\nTip: in Google Images, open a photo → right-click → “Copy image address”.');
    if (!url) return;
    if (!/^https?:\/\//i.test(url.trim())) return toast('Image link must start with http(s)://');
    const u = url.trim();
    updatePin(pin, { images: [...(pin.images || []), { thumb: u, full: u, page: u, title: pin.name, src: 'Added manually', custom: true }] });
  };

  const removeImage = (pin, i) => updatePin(pin, { images: pin.images.filter((_, k) => k !== i) });

  const stepPin = (d) => {
    const i = pins.findIndex((p) => p.id === selectedPinId);
    selectPin(pins[(i + d + pins.length) % pins.length].id);
  };

  // ---------- reference ----------
  const filteredRef = useMemo(() => (refPlaces || []).filter((p) =>
    (prefs.refArea === 'all' || p.area === prefs.refArea)
    && (prefs.refBucket === 'all' || bucketOf(p.category) === prefs.refBucket)), [refPlaces, prefs.refArea, prefs.refBucket]);

  const selectRef = (id) => {
    setSelectedRefId(id);
    const r = refPlaces?.find((x) => x.id === id);
    if (r) flyTo(r.lat, r.lng, 11);
  };

  const toggleRef = () => {
    updatePrefs({ refOn: !prefs.refOn });
    if (prefs.refOn) setSelectedRefId(null);
  };

  // ---------- import / export ----------
  const importData = async (data, source) => {
    const res = await guarded(() => api.importLegacy(data));
    if (!res) return;
    if (source === 'legacy') {
      try { localStorage.setItem(LEGACY_KEY + '.imported', '1'); } catch { /* ignore */ }
      setLegacyCount(0);
    }
    const p = await reload();
    if (p) fitPins(p);
    toast(`Imported ${res.added} place(s)${res.skipped ? `, skipped ${res.skipped} duplicate(s)` : ''}`);
  };

  const importLegacyLocal = () => {
    try { importData(JSON.parse(localStorage.getItem(LEGACY_KEY)), 'legacy'); } catch (e) { toast('Import failed: ' + e.message); }
  };

  const onImportFile = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try { await importData(JSON.parse(await file.text()), 'file'); } catch (err) { toast('Import failed: ' + err.message); }
  };

  const exportData = () => {
    // Same shape as the first version's export, so it can be re-imported
    const data = {
      groups: groups.map((g) => ({ id: g.id, name: g.name, color: g.color })),
      places: pins.map(({ group, ...p }) => ({ ...p, groupId: group ?? 'none' })),
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `bali-pins-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || lightbox || groupDlg || pwPrompt) return;
      if (selectedRefId) setSelectedRefId(null);
      else if (selectedPinId) setSelectedPinId(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightbox, groupDlg, pwPrompt, selectedRefId, selectedPinId]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (e) => !e.target.closest('.menu') && setMenuOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuOpen]);

  const selectedPin = pins.find((p) => p.id === selectedPinId);
  const refSummary = refPlaces?.find((r) => r.id === selectedRefId);

  return (
    <div id="app">
      <aside id="sidebar">
        <header className="top">
          <div className="brand">
            <span className="logo">🌴</span>
            <div>
              <h1>Bali Pin Map</h1>
              <span className="saved">{loadError ? '⚠️ Offline' : canWrite ? 'Saved to the database' : '🔒 View only'}</span>
            </div>
          </div>
          <div className="menu">
            <button type="button" className="menu-btn" title="Options" onClick={() => setMenuOpen((o) => !o)}>⋯</button>
            {menuOpen && (
              <div className="menu-pop" onClick={() => setMenuOpen(false)}>
                <button type="button" onClick={exportData}>⬇️ Export data (JSON)</button>
                <button type="button" onClick={() => fileInput.current.click()}>⬆️ Import data (JSON)</button>
                {authRequired && (getPassword()
                  ? <button type="button" onClick={() => { setPassword(''); setAuthRequired(true); toast('Locked on this device'); }}>🔒 Lock (forget password)</button>
                  : <button type="button" onClick={async () => { await askPassword(); }}>🔓 Unlock editing</button>)}
              </div>
            )}
          </div>
          <input type="file" ref={fileInput} accept="application/json,.json" hidden onChange={onImportFile} />
        </header>

        <SearchPanel pins={pins} groups={groups} activeGroup={prefs.activeGroup} activeColor={activeGroupObj.color}
          onActiveGroup={(v) => updatePrefs({ activeGroup: v })}
          onPreview={(r) => { setPreview(r); if (r) flyTo(r.lat, r.lng, 13); }}
          onPin={addPin} />

        <div className="scroll">
          {loadError && <div className="banner error">Could not reach the server: {loadError}. <button type="button" className="link" onClick={reload}>Retry</button></div>}
          {legacyCount > 0 && (
            <div className="banner">
              Found {legacyCount} pin(s) saved by the previous version in this browser.
              <button type="button" className="btn primary sm" onClick={importLegacyLocal}>Import them</button>
              <button type="button" className="link" onClick={() => setLegacyCount(0)}>Dismiss</button>
            </div>
          )}

          {selectedPin ? (
            <PinDetail
              pin={selectedPin} index={pins.indexOf(selectedPin) + 1} total={pins.length} groups={groups}
              groupOf={groupOf} pins={pins} imagesLoading={imagesLoading.has(selectedPin.id)} toast={toast}
              onBack={() => setSelectedPinId(null)} onStep={stepPin} onUpdate={updatePin} onUnpin={unpin}
              onMoreImages={(p) => loadImages(p, true)} onAddImage={addImage} onRemoveImage={removeImage}
              onOpenImage={(items, index) => setLightbox({ items, index })} onSelect={selectPin}
            />
          ) : (
            <>
              <GroupChips groups={groups} ungrouped={UNGROUPED} counts={counts} isHidden={isHidden}
                onToggle={toggleGroup} onSolo={soloGroup}
                onShowAll={() => updatePrefs({ hiddenGroups: [] })}
                onEdit={(g) => setGroupDlg({ group: g })} onAdd={() => setGroupDlg({ group: null })} />
              <PinList pins={pins} groups={groups} ungrouped={UNGROUPED} groupOf={groupOf} isHidden={isHidden}
                selectedPinId={selectedPinId} onSelect={selectPin} onUnpin={unpin}
                showLabels={prefs.showLabels} onShowLabels={(v) => updatePrefs({ showLabels: v })} onFit={() => fitPins()} />
            </>
          )}
        </div>
      </aside>

      <main className="map-wrap">
        <MapView
          setMap={setMap} pins={pins} groupOf={groupOf} isHidden={isHidden} selectedPinId={selectedPinId}
          onSelectPin={selectPin} onMovePin={movePin} showLabels={prefs.showLabels}
          baseLayer={prefs.baseLayer} onBaseLayerChange={(name) => updatePrefs({ baseLayer: name })}
          preview={preview} refPlaces={prefs.refOn ? filteredRef : null} selectedRefId={selectedRefId}
          onSelectRef={selectRef} onPinHere={pinHere}
        />

        <div className="ref-toolbar">
          <button type="button" className={'ref-toggle' + (prefs.refOn ? ' on' : '')} onClick={toggleRef}
            title="Show popular places in Bali & Nusa Penida (Google rating ≥ 4★, over 1,000 reviews)">
            <span className="switch"><span /></span>
            ⭐ Reference
          </button>
          {prefs.refOn && (
            <div className="ref-filters">
              <div className="ref-legend">
                <span>{refPlaces ? `${filteredRef.length} places · ≥4★ · >1,000 reviews` : 'Loading…'}</span>
                <span className="grad" style={{ background: REF_GRADIENT }} />
                <span className="grad-labels"><span>lower</span><span>higher rating &amp; reviews</span></span>
              </div>
              <div className="seg">
                {[['all', 'All'], ['bali', 'Bali'], ['penida', 'Nusa Penida']].map(([v, l]) => (
                  <button key={v} type="button" className={prefs.refArea === v ? 'on' : ''} onClick={() => updatePrefs({ refArea: v })}>{l}</button>
                ))}
              </div>
              <div className="seg wrap">
                {BUCKETS.map((b) => (
                  <button key={b.id} type="button" className={prefs.refBucket === b.id ? 'on' : ''}
                    onClick={() => updatePrefs({ refBucket: b.id })}>{b.label}</button>
                ))}
              </div>
            </div>
          )}
        </div>

        {selectedRefId && (
          <RefPanel key={selectedRefId} refId={selectedRefId} summary={refSummary} pins={pins}
            onClose={() => setSelectedRefId(null)} onPin={pinFromRef} onUnpin={unpin}
            onOpenImage={(items, index) => setLightbox({ items, index })} />
        )}
      </main>

      {groupDlg && (
        <GroupDialog group={groupDlg.group} usedColors={groups.map((g) => g.color)}
          onSave={saveGroup} onDelete={deleteGroup} onClose={() => setGroupDlg(null)} />
      )}
      {pwPrompt && (
        <PasswordDialog onDone={(pw) => {
          if (pw) { setPassword(pw); toast('🔓 Unlocked on this device'); }
          pwPrompt.resolve(pw);
          setPwPrompt(null);
        }} />
      )}
      {lightbox && <Lightbox key={lightbox.items[lightbox.index]?.full} items={lightbox.items} index={lightbox.index}
        onClose={() => setLightbox(null)} />}
      <div className={'toast' + (toastMsg ? ' show' : '')}>{toastMsg}</div>
    </div>
  );
}
