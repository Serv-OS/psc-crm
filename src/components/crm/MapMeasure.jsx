import { useEffect, useRef, useState, useCallback } from 'react';

// The website's instant-quote map tool, for staff (Peter, 23 Nov 2026).
// Search the address (or start on the lead's), click each corner of the
// building on the satellite view, Finish. Gives the footprint area and
// perimeter; the caller turns perimeter x storeys into wall sq ft.
// Kept in step with psc-website src/components/quote/RoofMeasure.tsx.

// The same browser key the public website uses for this tool.
const KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || 'AIzaSyC-h1nBsZnzEiTfFADky9zRrw59hyAr94I';
const M2_TO_FT2 = 10.763910417;
const M_TO_FT = 3.280839895;

let mapsPromise = null;
function loadMaps() {
  if (window.google?.maps?.geometry) return Promise.resolve(window.google);
  if (mapsPromise) return mapsPromise;
  mapsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${KEY}&libraries=places,geometry&v=weekly`;
    s.async = true;
    s.onload = () => resolve(window.google);
    s.onerror = () => { mapsPromise = null; reject(new Error('Google Maps did not load')); };
    document.head.appendChild(s);
  });
  return mapsPromise;
}

export default function MapMeasure({ initialAddress = '', onMeasure }) {
  const mapEl = useRef(null);
  const searchEl = useRef(null);
  const mapRef = useRef(null);
  const polyRef = useRef(null);
  const markersRef = useRef([]);
  const drawModeRef = useRef(false);
  const addressRef = useRef(initialAddress);
  const placesRef = useRef(null);
  const tokenRef = useRef(null);
  const timerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState('');
  const [drawing, setDrawing] = useState(false);
  const [measure, setMeasure] = useState(null);
  const [hints, setHints] = useState([]);

  const recompute = useCallback(() => {
    const g = window.google;
    const poly = polyRef.current;
    if (!poly || !g) return;
    const path = poly.getPath();
    if (path.getLength() < 3) { setMeasure(null); onMeasure(null); return; }
    const areaM2 = g.maps.geometry.spherical.computeArea(path);
    let perimM = g.maps.geometry.spherical.computeLength(path);
    perimM += g.maps.geometry.spherical.computeDistanceBetween(path.getAt(path.getLength() - 1), path.getAt(0));
    const m = { areaFt2: Math.round(areaM2 * M2_TO_FT2), perimeterFt: Math.round(perimM * M_TO_FT), address: addressRef.current };
    setMeasure(m); onMeasure(m);
  }, [onMeasure]);

  const clearMarkers = () => { markersRef.current.forEach((mk) => mk.setMap(null)); markersRef.current = []; };
  const clearPoly = useCallback(() => {
    if (polyRef.current) { polyRef.current.setMap(null); polyRef.current = null; }
    clearMarkers(); setMeasure(null); onMeasure(null);
  }, [onMeasure]);

  const lookUp = useCallback((text) => {
    clearTimeout(timerRef.current);
    const places = placesRef.current;
    if (!places || text.trim().length < 4) { setHints([]); return; }
    timerRef.current = setTimeout(async () => {
      try {
        if (!tokenRef.current) tokenRef.current = new places.AutocompleteSessionToken();
        const { suggestions } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: text, includedPrimaryTypes: ['street_address', 'premise', 'subpremise'], includedRegionCodes: ['us'], sessionToken: tokenRef.current,
        });
        setHints((suggestions || []).slice(0, 5));
      } catch { setHints([]); }
    }, 250);
  }, []);

  const goTo = useCallback((loc, addr) => {
    addressRef.current = addr || addressRef.current;
    if (searchEl.current) searchEl.current.value = addressRef.current;
    if (loc && mapRef.current) { mapRef.current.setCenter(loc); mapRef.current.setZoom(20); clearPoly(); }
  }, [clearPoly]);

  const pickHint = useCallback(async (s) => {
    setHints([]);
    try {
      const place = s.placePrediction.toPlace();
      await place.fetchFields({ fields: ['location', 'formattedAddress'] });
      goTo(place.location, place.formattedAddress || s.placePrediction.text?.text || '');
    } catch { /* keep what was typed */ }
    tokenRef.current = null;
  }, [goTo]);

  const startDraw = useCallback(() => { clearPoly(); drawModeRef.current = true; setDrawing(true); }, [clearPoly]);
  const finishDraw = useCallback(() => {
    drawModeRef.current = false; setDrawing(false); clearMarkers();
    const g = window.google; const poly = polyRef.current;
    if (poly && poly.getPath().getLength() >= 3) {
      poly.setEditable(true);
      const path = poly.getPath();
      ['set_at', 'insert_at', 'remove_at'].forEach((ev) => g.maps.event.addListener(path, ev, recompute));
      recompute();
    } else clearPoly();
  }, [clearPoly, recompute]);

  useEffect(() => {
    let cancelled = false;
    loadMaps().then((g) => {
      if (cancelled || !mapEl.current) return;
      const map = new g.maps.Map(mapEl.current, {
        center: { lat: 37.5629, lng: -122.3255 }, zoom: 19, mapTypeId: 'satellite', tilt: 0,
        disableDefaultUI: true, zoomControl: true, gestureHandling: 'greedy',
      });
      mapRef.current = map;
      g.maps.event.addListener(map, 'click', (e) => {
        if (!drawModeRef.current || !e.latLng) return;
        if (!polyRef.current) {
          polyRef.current = new g.maps.Polygon({ map, paths: [e.latLng], editable: false, clickable: false, fillColor: '#206a38', fillOpacity: 0.25, strokeColor: '#206a38', strokeWeight: 2 });
        } else polyRef.current.getPath().push(e.latLng);
        markersRef.current.push(new g.maps.Marker({
          position: e.latLng, map, clickable: false,
          icon: { path: g.maps.SymbolPath.CIRCLE, scale: 4, fillColor: '#fff', fillOpacity: 1, strokeColor: '#206a38', strokeWeight: 2 },
        }));
        recompute();
      });
      g.maps.importLibrary('places').then((places) => { if (places?.AutocompleteSuggestion) placesRef.current = places; }).catch(() => {});
      // Start on the lead's own house.
      if (initialAddress) {
        new g.maps.Geocoder().geocode({ address: initialAddress }, (res, status) => {
          if (status === 'OK' && res?.[0]) goTo(res[0].geometry.location, res[0].formatted_address);
        });
      }
      setReady(true);
    }).catch((e) => setErr(e.message));
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const btn = 'px-3.5 py-2 rounded-xl text-sm font-semibold';
  return (
    <div>
      <div className="relative mb-2">
        <input ref={searchEl} defaultValue={initialAddress} placeholder="Search the address…" autoComplete="off"
          onChange={(e) => lookUp(e.target.value)} onBlur={() => setTimeout(() => setHints([]), 150)}
          className="w-full px-3 py-2.5 bg-card border border-bdr rounded-xl text-sm text-paper focus:outline-none focus:border-ember" />
        {hints.length > 0 && (
          <ul className="absolute z-20 top-full left-0 right-0 mt-1 p-1 bg-white border border-bdr rounded-xl shadow-lg">
            {hints.map((s, i) => (
              <li key={s.placePrediction?.placeId || i}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pickHint(s)}
                  className="block w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-slate-50">{s.placePrediction?.text?.text || ''}</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="relative rounded-xl overflow-hidden border border-bdr">
        <div ref={mapEl} style={{ width: '100%', height: 360 }} />
        {!ready && !err && <div className="absolute inset-0 flex items-center justify-center text-sm text-dim bg-slate-50">Loading map…</div>}
        {err && <div className="absolute inset-0 flex items-center justify-center text-sm text-red-600 bg-red-50 p-4 text-center">{err}</div>}
        {drawing && <div className="absolute top-2 left-2 right-2 text-center text-xs font-semibold text-white bg-emerald-900/90 rounded-lg px-3 py-2">Click each corner of the building, then press Finish outline.</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-2">
        {!drawing && <button type="button" onClick={startDraw} disabled={!ready} className={`${btn} btn-glass`}>{measure ? 'Redraw outline' : 'Draw the building outline'}</button>}
        {drawing && <button type="button" onClick={finishDraw} className={`${btn} btn-glass`}>Finish outline</button>}
        {measure && !drawing && <button type="button" onClick={clearPoly} className={`${btn} btn-ghost`}>Clear</button>}
        {measure && <span className="text-sm text-paper">Footprint <strong>{measure.areaFt2.toLocaleString('en-US')} sq ft</strong> · Perimeter <strong>{measure.perimeterFt.toLocaleString('en-US')} ft</strong></span>}
      </div>
    </div>
  );
}
