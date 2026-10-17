// Cheap rule checks that run before any AI. Each returns plain-language findings for a person.
// A finding is { key, level, title, detail } with level 'ok' | 'flag' | 'info'.
// 'flag' means "a person should look", never "something is wrong".
const exifr = require('exifr');
const { hamming, ncc } = require('./imagefeatures');
const { PHRASES } = require('./wording');

const REUSE_MAX_DISTANCE = 6; // out of 63. Different months of the same fixed view sit at 8 to 34.
const COMPARABLE_NCC = 0.42; // edge correlation at or above this: views comparable
const CAUTION_NCC = 0.3; // between the two: compare with caution; below: not comparable

// ---------- metadata ----------
function exifDateToIso(v) {
  if (!v) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // exifr gives local wall-clock time as if it were the server's zone; keep the wall clock.
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}T${p(v.getHours())}:${p(v.getMinutes())}`;
  }
  const m = String(v).match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}` : null;
}

async function readExif(buf) {
  try {
    const out = await exifr.parse(buf, { tiff: true, exif: true, gps: true, reviveValues: false });
    if (!out) return { taken: null, gps: null, make: null, model: null };
    const taken = exifDateToIso(out.DateTimeOriginal || out.CreateDate || out.DateTime);
    let gps = null;
    if (typeof out.latitude === 'number' && typeof out.longitude === 'number') gps = { lat: out.latitude, lon: out.longitude };
    return { taken, gps, make: out.Make || null, model: out.Model || null };
  } catch (e) {
    return { taken: null, gps: null, make: null, model: null, error: 'Could not read the file metadata.' };
  }
}

// A printed camera stamp as typed by the uploader (or recorded for the demo frames).
// Accepts MM-DD-YYYY [weekday] HH:MM[:SS] (security cameras) and YYYY-MM-DD HH:MM.
function parseStamp(text) {
  if (!text) return null;
  const s = String(text).trim();
  let m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:\s+\w{3})?(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}T${(m[4] || '00').padStart(2, '0')}:${m[5] || '00'}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4] || '00'}:${m[5] || '00'}`;
  return null;
}

function dayDiff(a, b) {
  return Math.abs(Math.round((Date.parse(a.slice(0, 10)) - Date.parse(b.slice(0, 10))) / 86400000));
}
function human(iso) {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return `${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })} ${d.getUTCFullYear()}`;
}

// Printed stamp vs embedded file date vs reporting period.
function dateChecks(photo, period) {
  const out = [];
  const stamp = parseStamp(photo.stampText);
  const emb = photo.exif && photo.exif.taken;
  if (stamp && emb && dayDiff(stamp, emb) > 1) {
    out.push({
      key: 'stamp_vs_file',
      level: 'flag',
      title: `Printed stamp ${human(stamp)}, file date ${human(emb)}`,
      detail: `The date printed on the photo and the date stored in the file disagree. ${PHRASES.metadataMismatch} Common causes: the file was exported or re-saved later, or the camera clock is wrong.`
    });
  } else if (stamp && emb) {
    out.push({ key: 'stamp_vs_file', level: 'ok', title: 'Printed stamp and file date agree', detail: `${human(stamp)}.` });
  }
  const best = stamp || emb;
  const src = stamp ? 'printed camera stamp' : 'file date';
  if (!best) {
    out.push({ key: 'capture_date', level: 'info', title: 'No capture date on the photo or in the file', detail: PHRASES.missingMetadata });
  } else if (best.slice(0, 7) !== period) {
    out.push({
      key: 'capture_date',
      level: 'flag',
      title: `Taken ${human(best)} (${src}), outside the reporting period ${period}`,
      detail: `${PHRASES.metadataMismatch} The submitter may have a reason, for example a reference shot.`
    });
  } else {
    out.push({ key: 'capture_date', level: 'ok', title: `Taken ${human(best)} (${src}), inside the reporting period`, detail: '' });
  }
  return out;
}

function haversineM(a, b) {
  const R = 6371e3;
  const r = (x) => (x * Math.PI) / 180;
  const d1 = r(b.lat - a.lat);
  const d2 = r(b.lon - a.lon);
  const h = Math.sin(d1 / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(d2 / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function locationCheck(photo, site) {
  const gps = photo.exif && photo.exif.gps;
  if (!gps) {
    return { key: 'location', level: 'info', title: 'No location in the file', detail: PHRASES.missingMetadata };
  }
  if (!site || typeof site.lat !== 'number') {
    return { key: 'location', level: 'info', title: `Location ${gps.lat.toFixed(5)}, ${gps.lon.toFixed(5)}`, detail: 'No site location is set for this project, so it cannot be compared.' };
  }
  const d = haversineM(gps, site);
  const radius = site.radiusM || 300;
  if (d <= radius) return { key: 'location', level: 'ok', title: 'Location inside the site boundary', detail: `${Math.round(d)} m from the site point.` };
  const dist = d > 2000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`;
  return { key: 'location', level: 'flag', title: `Location ${dist} from the site`, detail: `${PHRASES.metadataMismatch} Phone GPS can be off, especially in mountain areas.` };
}

// Reuse and flip detection against every other photo on file in this office.
function reuseCheck(photo, others) {
  let best = null;
  for (const o of others) {
    if (o.id === photo.id) continue;
    const d1 = hamming(photo.phash, o.phash);
    const d2 = hamming(photo.phashMirror, o.phash);
    if (d1 !== null && (!best || d1 < best.d)) best = { d: d1, o, mirrored: false };
    if (d2 !== null && (!best || d2 < best.d)) best = { d: d2, o, mirrored: true };
  }
  if (best && best.d <= REUSE_MAX_DISTANCE) {
    const where = best.o.projectId === photo.projectId ? `this project, ${best.o.period}` : `another project (${best.o.projectName || best.o.projectId}), ${best.o.period}`;
    return {
      key: 'reuse',
      level: 'flag',
      title: `Very close to a photo already on file: ${where}${best.mirrored ? ', mirrored' : ''}`,
      detail: `Distance ${best.d} of 63. ${PHRASES.reuseFlag} It may be a reference shot or the wrong file.`,
      matchPhotoId: best.o.id,
      distance: best.d,
      mirrored: best.mirrored
    };
  }
  return {
    key: 'reuse',
    level: 'ok',
    title: 'No near-duplicate among photos on file',
    detail: best ? `Nearest is distance ${best.d} of 63. Different photos of the same view usually sit at 8 or more. Crops can get past this check.` : 'No earlier photos to compare with.'
  };
}

// Are this period's view and last period's view comparable?
function comparabilityCheck(photo, prev) {
  if (!prev) {
    return { key: 'comparable', level: 'info', title: 'No earlier period to compare views with', detail: '', comparable: null };
  }
  const notes = [];
  const srcA = photo.sourceResolution || `${photo.width}x${photo.height}`;
  const srcB = prev.sourceResolution || `${prev.width}x${prev.height}`;
  if (srcA !== srcB) notes.push(`source resolution changed (${srcB} to ${srcA})`);
  if (photo.framingNote) notes.push(photo.framingNote);
  const r = ncc(photo.edges, prev.edges);
  let level = 'ok';
  let title = `Views comparable with ${prev.period}`;
  let comparable = 'yes';
  if (r === null) {
    level = 'info';
    title = 'Could not compare the views';
    comparable = null;
  } else if (r < CAUTION_NCC) {
    level = 'flag';
    title = `Views not comparable with ${prev.period}`;
    comparable = 'no';
    notes.unshift('the camera position, zoom or framing differs too much');
  } else if (r < COMPARABLE_NCC || notes.length) {
    level = 'flag';
    title = `Compare with caution against ${prev.period}`;
    comparable = 'caution';
  }
  return {
    key: 'comparable',
    level,
    title,
    detail: `${notes.length ? `${notes.join('; ')}. ` : ''}Edge match ${r === null ? 'n/a' : r.toFixed(2)}. ${PHRASES.noVisibleChange}`,
    comparable,
    score: r
  };
}

module.exports = {
  REUSE_MAX_DISTANCE,
  COMPARABLE_NCC,
  CAUTION_NCC,
  readExif,
  parseStamp,
  dateChecks,
  locationCheck,
  haversineM,
  reuseCheck,
  comparabilityCheck
};
