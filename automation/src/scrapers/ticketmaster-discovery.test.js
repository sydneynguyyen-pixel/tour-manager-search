// Unit tests for Ticketmaster tour discovery's pure logic (event attribution,
// per-artist grouping, the >5-date threshold, festival skipping, dedupe,
// image/genre extraction). Pure/synchronous — no network.
// Run with:  node src/scrapers/ticketmaster-discovery.test.js   (from automation/)

const logger = require('../utils/logger');
const {
  extractBrowseEvent,
  groupToursFromBrowseEvents,
  pickAttractionImage,
  attractionGenre,
  plausibleOnSaleDate,
} = require('./ticketmaster-discovery');

let failures = 0;
function assert(cond, msg) {
  if (cond) logger.success(`PASS ${msg}`);
  else { failures += 1; logger.error(`FAIL ${msg}`); }
}

// --- Builders for realistic Ticketmaster Discovery event payloads ------------
function tmEvent({ artist, id, date, venue = 'The Venue', city = 'Anytown', onsale, url, extraAttractions = [], images, classifications }) {
  const headliner = {
    name: artist,
    id: id ?? `attr-${String(artist).toLowerCase().replace(/\s+/g, '-')}`,
    images: images ?? [
      { url: `https://img/${artist}-3x2.jpg`, ratio: '3_2', width: 305, height: 203 },
      { url: `https://img/${artist}-16x9.jpg`, ratio: '16_9', width: 1024, height: 576 },
    ],
    classifications: classifications ?? [{ segment: { name: 'Music' }, genre: { name: 'Pop' } }],
  };
  return {
    name: `${artist} at ${venue}`,
    url: url ?? `https://ticketmaster.com/event/${String(artist).toLowerCase()}-${date}`,
    dates: { start: { localDate: date } },
    sales: onsale ? { public: { startDateTime: onsale } } : undefined,
    _embedded: {
      venues: [{ name: venue, city: { name: city } }],
      attractions: [headliner, ...extraAttractions],
    },
  };
}

// A helper to synthesize N dates for one artist across cities/venues.
function tourEvents(artist, n, opts = {}) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const day = String(10 + i).padStart(2, '0');
    out.push(tmEvent({ artist, date: `2026-09-${day}`, venue: `Venue ${i}`, city: `City ${i}`, ...opts }));
  }
  return out;
}

// === extractBrowseEvent ======================================================
{
  const rec = extractBrowseEvent(tmEvent({ artist: 'Big Star', date: '2026-09-10', onsale: '2026-07-01T17:00:00Z' }));
  assert(rec && rec.artist === 'Big Star', 'extract: reads headliner name');
  assert(rec.date === '2026-09-10', 'extract: reads event date');
  assert(rec.venue === 'The Venue' && rec.city === 'Anytown', 'extract: reads venue + city');
  assert(rec.onSaleDate === '2026-07-01T17:00:00Z', 'extract: reads plausible on-sale date');
  assert(typeof rec.url === 'string' && rec.url.length > 0, 'extract: carries a ticketing url');
  assert(rec.genre === 'Pop', 'extract: reads genre from classification');
  assert(rec.imageUrl === 'https://img/Big Star-16x9.jpg', 'extract: prefers the wide 16:9 image');
}

// Festival / multi-bill (too many attractions) -> not attributable.
{
  const festival = tmEvent({
    artist: 'Headliner',
    date: '2026-09-10',
    extraAttractions: [{ name: 'Act B' }, { name: 'Act C' }, { name: 'Act D' }, { name: 'Act E' }],
  });
  assert(extractBrowseEvent(festival) === null, 'extract: skips festival-sized bills (> 3 attractions)');
}

// No attractions, or no date -> null.
assert(extractBrowseEvent({ dates: { start: { localDate: '2026-09-10' } }, _embedded: { attractions: [] } }) === null, 'extract: null when no attractions');
assert(extractBrowseEvent(tmEvent({ artist: 'No Date', date: undefined })) === null, 'extract: null when no date');

// A co-headline (2 attractions) is still attributable to the first act.
{
  const co = tmEvent({ artist: 'Lead Act', date: '2026-09-10', extraAttractions: [{ name: 'Second Act' }] });
  const rec = extractBrowseEvent(co);
  assert(rec && rec.artist === 'Lead Act', 'extract: co-headline attributes to first-listed act');
}

// 1900 sentinel on-sale date is treated as unknown.
{
  const rec = extractBrowseEvent(tmEvent({ artist: 'Sentinel', date: '2026-09-10', onsale: '1900-01-01T00:00:00Z' }));
  assert(rec.onSaleDate === null, 'extract: 1900 on-sale sentinel -> null');
}

// === plausibleOnSaleDate / image / genre helpers =============================
assert(plausibleOnSaleDate('2026-07-01T17:00:00Z') === '2026-07-01T17:00:00Z', 'onsale: keeps a real date');
assert(plausibleOnSaleDate('1900-01-01T00:00:00Z') === null, 'onsale: rejects the 1900 sentinel');
assert(plausibleOnSaleDate('9999-12-31T06:00:00Z') === null, 'onsale: rejects the 9999 sentinel');
assert(plausibleOnSaleDate(null) === null, 'onsale: null in -> null out');
assert(pickAttractionImage({ images: [] }) === null, 'image: no images -> null');
assert(
  pickAttractionImage({ images: [{ url: 'a', ratio: '3_2', width: 2000 }, { url: 'b', ratio: '16_9', width: 640 }] }) === 'b',
  'image: prefers wide 16:9 even when a larger non-16:9 exists'
);
assert(
  pickAttractionImage({ images: [{ url: 'a', ratio: '3_2', width: 2000 }, { url: 'b', ratio: '4_3', width: 300 }] }) === 'a',
  'image: falls back to the widest when no qualifying 16:9'
);
assert(attractionGenre({ classifications: [{ genre: { name: 'Undefined' }, segment: { name: 'Music' } }] }) === 'Music', 'genre: skips Undefined, falls back to segment');
assert(attractionGenre({ classifications: [{ genre: { name: 'Undefined' }, segment: { name: 'Undefined' } }] }) === null, 'genre: all-Undefined -> null');

// === groupToursFromBrowseEvents ==============================================
// Core threshold: exactly 6 dates qualifies (> 5), 5 does not.
{
  const recs6 = tourEvents('Sixer', 6).map(extractBrowseEvent);
  const recs5 = tourEvents('Fiver', 5).map(extractBrowseEvent);
  const tours = groupToursFromBrowseEvents([...recs6, ...recs5]);
  const names = tours.map((t) => t.artist);
  assert(names.includes('Sixer'), 'group: 6-date tour qualifies (> 5)');
  assert(!names.includes('Fiver'), 'group: 5-date run is excluded');
  const sixer = tours.find((t) => t.artist === 'Sixer');
  assert(sixer.dateCount === 6, 'group: reports the true date count');
  assert(sixer.events.length === 6 && sixer.events[0].date <= sixer.events[5].date, 'group: events sorted ascending by date');
}

// Single show is excluded.
{
  const tours = groupToursFromBrowseEvents(tourEvents('Single', 1).map(extractBrowseEvent));
  assert(tours.length === 0, 'group: a single show never becomes a tour');
}

// National aggregation: the same artist's dates arrive interleaved (as they
// would from different state queries) and still sum to one tour.
{
  const interleaved = [
    ...tourEvents('Roadshow', 3, {}),
    ...tourEvents('Other Band', 2, {}),
    ...tourEvents('Roadshow', 4, {}).map((e) => ({ ...e, dates: { start: { localDate: e.dates.start.localDate.replace('2026-09', '2026-10') } } })),
  ].map(extractBrowseEvent);
  const tours = groupToursFromBrowseEvents(interleaved);
  const road = tours.find((t) => t.artist === 'Roadshow');
  assert(road && road.dateCount === 7, 'group: aggregates one act across interleaved segments (3 + 4 = 7)');
}

// Dedupe by date+venue: the same show listed twice counts once (and so a tour
// padded with duplicates does NOT clear the threshold on dupes alone).
{
  const one = tmEvent({ artist: 'Dupe', date: '2026-09-10', venue: 'Same Hall', city: 'Town' });
  const recs = Array.from({ length: 8 }, () => extractBrowseEvent(one));
  const tours = groupToursFromBrowseEvents(recs);
  assert(tours.length === 0, 'group: 8 copies of ONE show dedupe to 1 date -> not a tour');
}

// earliestOnSaleDate is the minimum across the tour's on-sale dates.
{
  const recs = [
    extractBrowseEvent(tmEvent({ artist: 'OnsaleAct', date: '2026-09-10', venue: 'V1', onsale: '2026-07-05T17:00:00Z' })),
    extractBrowseEvent(tmEvent({ artist: 'OnsaleAct', date: '2026-09-11', venue: 'V2', onsale: '2026-06-20T17:00:00Z' })),
    ...tourEvents('OnsaleAct', 5, {}).map(extractBrowseEvent),
  ];
  const tours = groupToursFromBrowseEvents(recs);
  const act = tours.find((t) => t.artist === 'OnsaleAct');
  assert(act.earliestOnSaleDate === '2026-06-20T17:00:00Z', 'group: earliestOnSaleDate = min on-sale across the run');
}

// Sorted biggest-tour-first.
{
  const tours = groupToursFromBrowseEvents([
    ...tourEvents('Small Tour', 6).map(extractBrowseEvent),
    ...tourEvents('Huge Tour', 20).map(extractBrowseEvent),
  ]);
  assert(tours[0].artist === 'Huge Tour', 'group: sorts biggest tour first');
}

if (failures > 0) { logger.error(`${failures} discovery check(s) failed.`); process.exit(1); }
logger.success('Ticketmaster discovery checks passed.');
