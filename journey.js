/* ParkPilot visit planning. Personal plans are stored on-device with the existing backup. */
const parkSchedules = {}, scheduleLoading = {}, scheduleFetched = {}, facilityCache = {}, facilityLoading = {}, facilityErrors = {};
let memorySaving = false;
let breakCategory = 'water', passportPhotoURLs = new Map(), milestonePerson = '';
const parkZone = (key = state.park) => ['dl', 'ca'].includes(key) ? 'America/Los_Angeles' : 'America/New_York';
const newEntryId = () => crypto.randomUUID();
function validVisitDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value; }
function parkDate(key = state.park, time = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: parkZone(key), year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(time);
  const value = type => parts.find(p => p.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
function initializeJourney() {
  const savedJourney = state.journey && typeof state.journey === 'object' ? state.journey : {};
  state.journey = {
    date: validVisitDate(savedJourney.date) ? savedJourney.date : parkDate(),
    energy: ['relaxed', 'balanced', 'adventure'].includes(savedJourney.energy) ? savedJourney.energy : 'balanced',
    priorities: savedJourney.priorities && typeof savedJourney.priorities === 'object' ? savedJourney.priorities : {},
    appointments: Array.isArray(savedJourney.appointments) ? savedJourney.appointments : [],
    splits: Array.isArray(savedJourney.splits) ? savedJourney.splits : [],
    memories: Array.isArray(savedJourney.memories) ? savedJourney.memories : [],
    catalog: savedJourney.catalog && typeof savedJourney.catalog === 'object' ? savedJourney.catalog : {}
  };
  state.people = state.people.map(person => ({...person, id: person.id || newEntryId()}));
}
const visitKey = () => state.park + ':' + state.journey.date;
const visitEntries = list => list.filter(entry => entry.park === state.park && entry.date === state.journey.date);
const priorityIds = () => state.journey.priorities[visitKey()] || [];
function saveVisit(resetForms = false) { save(); render(resetForms); }
function visitControls() {
  return `<div class="visit-controls"><div><label for="visitDate">Visit date · ${ESC(parkZone())}</label><input class="field" type="date" id="visitDate" value="${ESC(state.journey.date)}" onchange="setVisitDate(this.value)"></div><div><label for="visitEnergy">Your pace</label><select class="field" id="visitEnergy" onchange="state.journey.energy=this.value;saveVisit()">${[['relaxed', 'Take it easy'], ['balanced', 'A little of everything'], ['adventure', 'More adventures']].map(([value, label]) => `<option value="${value}" ${state.journey.energy === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div></div>`;
}
function setVisitDate(value) { if (validVisitDate(value)) { state.journey.date = value; saveVisit(true); } }
function rememberPlace(id) {
  const place = live.find(p => p.id === id) || (placeCatalog[state.park] || []).find(p => p.id === id);
  if (place) state.journey.catalog[id] = {id, name: place.name, park: state.park, entityType: place.entityType || 'ATTRACTION'};
}
function savedPlace(id) { return live.find(p => p.id === id) || state.journey.catalog[id] || {id, name: 'Saved attraction · ' + id.slice(0, 8)}; }
function selectedPlan() { return state.plan.filter(id => !state.journey.catalog[id]?.park || state.journey.catalog[id].park === state.park); }
function togglePriority(id) {
  rememberPlace(id);
  const ids = priorityIds();
  state.journey.priorities[visitKey()] = ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id];
  if (!ids.includes(id) && !state.plan.includes(id)) state.plan.push(id);
  saveVisit();
}
function movePriority(id, direction) {
  const ids = [...priorityIds()], from = ids.indexOf(id), to = from + direction;
  if (from < 0 || to < 0 || to >= ids.length) return;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  state.journey.priorities[visitKey()] = ids; saveVisit();
}
async function loadVisitSchedule(key, id) {
  if (scheduleLoading[key] || (parkSchedules[key] && Date.now() - (scheduleFetched[key] || 0) < 300000)) return;
  scheduleLoading[key] = true;
  try {
    const response = await fetch(`${API}/entity/${encodeURIComponent(id)}/schedule`);
    if (!response.ok) throw Error('Schedule unavailable');
    const data = await response.json();
    parkSchedules[key] = Array.isArray(data.schedule) ? data.schedule : []; scheduleFetched[key] = Date.now();
  } catch { parkSchedules[key] = []; }
  finally { scheduleLoading[key] = false; if (state.park === key && ['today', 'next', 'plan'].includes(tab)) render(); }
}
function visitHours() {
  return (parkSchedules[state.park] || []).filter(entry => entry.date === state.journey.date && entry.type === 'OPERATING' && Number.isFinite(Date.parse(entry.openingTime)) && Number.isFinite(Date.parse(entry.closingTime)));
}
function scheduleText() {
  const entries = visitHours();
  return entries.length ? entries.map(entry => `${new Date(entry.openingTime).toLocaleTimeString([], {timeZone: parkZone(), hour: 'numeric', minute: '2-digit'})}–${new Date(entry.closingTime).toLocaleTimeString([], {timeZone: parkZone(), hour: 'numeric', minute: '2-digit'})}`).join(' · ') : 'Published operating hours unavailable for this date';
}
function appointmentTimestamp(entry) {
  if (!validVisitDate(entry.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.time || '')) return NaN;
  const [year, month, day] = entry.date.split('-').map(Number), [hour, minute] = entry.time.split(':').map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute); let candidate = desired;
  const formatter = new Intl.DateTimeFormat('en-CA', {timeZone: parkZone(entry.park), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = formatter.formatToParts(new Date(candidate)), get = type => Number(parts.find(p => p.type === type).value);
    const displayed = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
    if (displayed === desired) return candidate;
    candidate += desired - displayed;
  }
  return NaN;
}
function nextAppointment(now = new Date()) {
  return visitEntries(state.journey.appointments).filter(a => !a.done && appointmentTimestamp(a) + a.duration * 60000 >= now).sort((a, b) => appointmentTimestamp(a) - appointmentTimestamp(b))[0] || null;
}
function appointmentNotice() {
  const next = nextAppointment(); if (!next) return '';
  const remaining = Math.ceil((appointmentTimestamp(next) - Date.now()) / 60000);
  return `<div class="note appointment-notice"><strong>${remaining < 0 ? 'Reservation time has started' : `Coming up in ${remaining} min`}</strong><p>${ESC(next.time)} · ${ESC(next.title)}</p><button class="miniBtn" onclick="go('plan')">View visit plan</button></div>`;
}
function distanceMeters(a, b) {
  if (!a || !b) return null;
  const rad = Math.PI / 180, lat = (b[0] - a[0]) * rad, lon = (b[1] - a[1]) * rad;
  const value = Math.sin(lat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(lon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
}
const distanceLabel = distance => distance === null ? 'Set a map start for proximity' : distance < 1000 ? Math.round(distance / 10) * 10 + ' m straight-line' : (distance / 1000).toFixed(1) + ' km straight-line';
function nextActivities(now = new Date()) {
  if (dataPark !== state.park) return [];
  const isCurrentVisit = state.journey.date === parkDate(state.park, now) || visitHours().some(h => Date.parse(h.openingTime) <= now && Date.parse(h.closingTime) > now);
  if (!isCurrentVisit) return [];
  const heights = state.people.filter(p => p.selected).map(p => Number(p.height));
  const priority = priorityIds(), upcoming = nextAppointment(now), minutesToReservation = upcoming ? (appointmentTimestamp(upcoming) - now) / 60000 : null;
  const hours = visitHours(), currentHours = hours.find(h => Date.parse(h.openingTime) <= now && Date.parse(h.closingTime) > now);
  if (hours.length && !currentHours) return [];
  const closingMinutes = currentHours ? (Date.parse(currentHours.closingTime) - now) / 60000 : null;
  return live.filter(ride => ride.status === 'OPERATING' && Number.isFinite(ride.wait) && ride.wait >= 0 && ride.wait <= state.maxWait && eligible(ride, heights, true) && !isVisitDone(ride.id))
    .filter(ride => (closingMinutes === null || ride.wait < closingMinutes) && (minutesToReservation === null || minutesToReservation > ride.wait + 15))
    .map(ride => {
      const coordinates = placeCoordinates((placeCatalog[state.park] || []).find(p => p.id === ride.id));
      const distance = mapOrigin ? distanceMeters(mapOrigin.coords, coordinates) : null;
      const rank = priority.indexOf(ride.id), priorityBonus = rank >= 0 ? Math.max(8, 30 - rank * 4) : 0;
      const distanceWeight = {relaxed: 60, balanced: 100, adventure: 150}[state.journey.energy];
      const score = ride.wait + (distance === null ? 0 : distance / distanceWeight) - priorityBonus - (state.favorites.includes(ride.id) ? 8 : 0);
      return {ride, distance, score, reason: `${rank >= 0 ? `Must-do #${rank + 1} · ` : ''}${state.favorites.includes(ride.id) ? 'Saved favorite · ' : ''}${ride.wait} min posted wait${distance === null ? '' : ' · ' + distanceLabel(distance)}`};
    }).sort((a, b) => a.score - b.score || a.ride.name.localeCompare(b.ride.name));
}
function journeyLaunchpad() {
  return `<div class="journey-launchpad"><button class="btn" onclick="go('next')">${icon('star')} What next?</button><button class="btn" onclick="go('break')">${icon('pin')} Find a break</button><button class="btn" onclick="go('passport')">${icon('calendar')} My passport</button></div>`;
}
function viewNextMove() {
  const choices = nextActivities();
  return `<div class="sectionhead"><h2>What should we do next?</h2></div>${parkSelect()}${visitControls()}${appointmentNotice()}<p class="tiny muted">${ESC(scheduleText())} · Powered by ThemeParks.wiki</p><div class="note">Ranked by checked family heights, posted waits, must-dos, favorites and proximity. Straight-line distance helps compare locations; open walking directions to check the actual route.</div><button class="btn wide" onclick="go('map')">${mapOrigin ? 'Change starting location' : 'Set device or test location'}</button>${status()}${choices.length ? choices.slice(0, 6).map((choice, i) => `<article class="ride journey-card"><span class="eyebrow">Option ${i + 1}</span><h3><button class="card-title" onclick='openDetails(${safeId(choice.ride.id)})'>${ESC(choice.ride.name)}${icon('next')}</button></h3><p class="tag good">${ESC(choice.reason)}</p><p class="tiny muted">All selected riders meet the checked height rule. Compare boarding conditions in details.</p><div class="row wrap"><button class="miniBtn" onclick='doSet("plan",${safeId(choice.ride.id)})'>${state.plan.includes(choice.ride.id) ? 'Remove from plan' : '+ My Plan'}</button><button class="miniBtn" onclick='detailsToMap(${safeId(choice.ride.id)})'>Show on map</button></div></article>`).join('') : `<div class="empty">${state.journey.date !== parkDate() ? 'Your selected visit is on another date. Live suggestions are available for today; your priorities and reservations are saved for the selected date.' : 'No verified suggestion fits the current waits, operating hours, selected heights and reservation buffer. You can browse rides, adjust your wait target or take a break.'}</div>`}<p class="foot">Queue time alone does not include walking, boarding, attraction duration or delays. Allow extra time before reservations. Unknown waits and height rules are excluded.</p>`;
}
function viewTripPlan() {
  const planned = selectedPlan(), priorities = priorityIds(), appointments = visitEntries(state.journey.appointments).sort((a, b) => a.time.localeCompare(b.time));
  return `<div class="sectionhead"><h2>Your visit plan</h2></div>${parkSelect()}${visitControls()}<p class="tiny muted">${ESC(scheduleText())}</p>${appointmentNotice()}<section class="panel"><h3>Must-do priorities</h3><p class="tiny muted">Select stars in your saved list, then order your must-dos for this park and date.</p>${priorities.map((id, index) => `<div class="planrow"><strong>${index + 1}. ${ESC(savedPlace(id).name)}</strong><div class="row"><button class="miniBtn" aria-label="Move priority up" ${index === 0 ? 'disabled' : ''} onclick='movePriority(${safeId(id)},-1)'>↑</button><button class="miniBtn" aria-label="Move priority down" ${index === priorities.length - 1 ? 'disabled' : ''} onclick='movePriority(${safeId(id)},1)'>↓</button><button class="miniBtn" aria-label="Remove must-do priority" onclick='togglePriority(${safeId(id)})'>×</button></div></div>`).join('') || '<p class="muted">Choose the experiences you would most regret missing.</p>'}</section><div class="sectionhead"><h2>Saved attractions</h2></div><section class="panel">${planned.map(id => `<div class="planrow"><div><strong>${ESC(savedPlace(id).name)}</strong><small class="muted">${state.done.includes(id) ? 'Completed' : 'Saved for your park plans'}</small></div><div class="row wrap"><button class="miniBtn ${priorities.includes(id) ? 'on' : ''}" aria-label="Toggle must-do priority" aria-pressed="${priorities.includes(id)}" onclick='togglePriority(${safeId(id)})'>${priorities.includes(id) ? '★ Must-do' : '☆ Must-do'}</button><button class="miniBtn" onclick='doSet("done",${safeId(id)})'>${state.done.includes(id) ? '✓ Done' : 'Mark done'}</button><button class="miniBtn" aria-label="Remove saved attraction" onclick='doSet("plan",${safeId(id)})'>×</button></div></div>`).join('') || '<p class="muted">Add attractions from Explore to start your plan.</p>'}</section><div class="sectionhead"><h2>Reservations & time commitments</h2></div><section class="panel">${appointments.map(a => `<div class="planrow"><div><strong>${ESC(a.time)} · ${ESC(a.title)}</strong><p class="tiny muted">${a.duration} min · ${a.done ? 'Completed' : 'Planned'}${a.notes ? ' · ' + ESC(a.notes) : ''}</p></div><div class="row"><button class="miniBtn" onclick='toggleAppointment(${safeId(a.id)})'>${a.done ? 'Reopen' : 'Done'}</button><button class="miniBtn" aria-label="Delete reservation" onclick='deleteAppointment(${safeId(a.id)})'>×</button></div></div>`).join('')}<form onsubmit="addAppointment(event)"><label for="reservationTitle">Reservation or activity</label><input class="field" id="reservationTitle" required maxlength="120" placeholder="Lunch at…"><div class="visit-controls"><div><label for="reservationTime">Park-local time</label><input class="field" type="time" id="reservationTime" required></div><div><label for="reservationDuration">Allow minutes</label><input class="field" type="number" min="5" max="360" step="5" value="60" id="reservationDuration" required></div></div><label for="reservationNotes">Notes</label><input class="field" id="reservationNotes" maxlength="500" placeholder="Confirmation details or meet-up instructions"><button class="btn primary wide" type="submit">Save time commitment</button></form><p class="tiny muted">This records your plans. Confirm bookings separately with Disney.</p></section><div class="sectionhead"><h2>Visit notes</h2></div><textarea class="field" rows="5" aria-label="Visit notes" oninput="state.notes=this.value;save()">${ESC(state.notes)}</textarea><button class="btn wide" onclick="exportPlan()">Copy itinerary</button>`;
}
function addAppointment(event) {
  event.preventDefault();
  const title = byId('reservationTitle').value.trim(), time = byId('reservationTime').value, duration = Number(byId('reservationDuration').value);
  if (!title || !/^\d{2}:\d{2}$/.test(time) || duration < 5 || duration > 360) return;
  if (!Number.isFinite(appointmentTimestamp({date:state.journey.date,time,park:state.park}))) return notify('Choose a valid time in the park timezone');
  state.journey.appointments.push({id: newEntryId(), park: state.park, date: state.journey.date, title, time, duration, notes: byId('reservationNotes').value.trim(), done: false}); saveVisit(true);
}
function toggleAppointment(id) { const item = state.journey.appointments.find(a => a.id === id); if (item) { item.done = !item.done; saveVisit(); } }
function deleteAppointment(id) { state.journey.appointments = state.journey.appointments.filter(a => a.id !== id); saveVisit(); }

// Official directory checked 2026-11-05. Search links intentionally contain no invented pins.
function officialBreakDirectory() {
  const park = PARKS.find(p => p.key === state.park).name;
  const california = ['dl','ca'].includes(state.park);
  const base = california ? 'https://disneyland.disney.go.com' : 'https://disneyworld.disney.go.com';
  const baby = base + '/guest-services/' + (california ? 'baby-center-lost-children/' : 'baby-care-centers/');
  const water = {mk:['TRON restrooms','Pinocchio’s Village Haus','Cosmic Ray’s Starlight Cafe'],ep:['Connections Cafe restrooms','Odyssey Building','CommuniCore Hall'],hs:['ABC Commissary restrooms','Pixar Plaza','Sunset Boulevard'],ak:['Flame Tree Barbecue','Mombasa Marketplace','Satu’li Canteen']};
  const entries = (water[state.park] || []).map(name => ({name:'Water refill · ' + name,category:'water',source:base+'/guest-services/bottle-filling-stations/',query:'water bottle refill station '+name+' '+park}));
  entries.push({name:'Baby Care Center',category:'changing',source:baby,query:'Baby Care Center '+park});
  const filtered = entries.filter(e => breakCategory === 'all' || e.category === breakCategory);
  const search = query => 'https://www.google.com/maps/search/?' + new URLSearchParams({api:'1',query});
  return `<section class="panel"><h3>Official park resources</h3><p class="tiny muted">Directory checked November 5, 2026. These are map searches, with no verified pin, distance or live availability. Confirm the result and access before starting directions.</p>${filtered.map(e => `<article class="link-card"><strong>${ESC(e.name)}</strong><a class="btn" href="${ESC(search(e.query))}" target="_blank" rel="noopener">Search on map ↗</a><a href="${ESC(e.source)}" target="_blank" rel="noopener">Disney source ↗</a></article>`).join('')}<a class="btn" href="${ESC(search((breakCategory === 'water' ? 'drinking water' : breakCategory === 'changing' ? 'baby changing restroom' : 'restrooms')+' '+park))}" target="_blank" rel="noopener">Search ${breakCategory === 'water' ? 'water points' : 'restrooms'} in ${ESC(park)} ↗</a><a class="btn" href="${base}/guest-services/restrooms/" target="_blank" rel="noopener">Official restroom information ↗</a></section>`;
}
function facilityType(tags) { return tags.amenity === 'drinking_water' ? 'water' : tags.changing_table === 'yes' ? 'changing' : 'restroom'; }
async function loadBreakFacilities() {
  const key = state.park;
  if (facilityLoading[key]) return;
  const cached = facilityCache[key];
  if (cached && Date.now() - cached.fetched < 86400000) return render();
  facilityLoading[key] = true; facilityErrors[key] = ''; render();
  try {
    const center = PARK_CENTERS[key];
    const query = `[out:json][timeout:20];is_in(${center[0]},${center[1]})->.areas;area.areas["tourism"="theme_park"]->.park;(nwr(area.park)["amenity"="toilets"];nwr(area.park)["amenity"="drinking_water"];nwr(area.park)["changing_table"="yes"];);out center;`;
    const response = await fetch('https://overpass-api.de/api/interpreter', {method: 'POST', body: new URLSearchParams({data: query}), signal: AbortSignal.timeout(25000)});
    if (!response.ok) throw Error('Facility map service returned ' + response.status);
    const data = await response.json();
    if (!Array.isArray(data.elements) || data.remark) throw Error('The facility map query could not complete');
    const entries = data.elements.map(element => {
      const coordinates = [element.lat ?? element.center?.lat, element.lon ?? element.center?.lon];
      if (!coordinates.every(Number.isFinite)) return null;
      const tags = element.tags || {}, category = facilityType(tags);
      return {id: `osm:${element.type}:${element.id}`, name: tags.name || (category === 'water' ? 'Drinking water point' : category === 'changing' ? 'Restroom with changing table' : 'Restroom'), category, coordinates, source: `https://www.openstreetmap.org/${element.type}/${element.id}`, wheelchair: tags.wheelchair || '', changing: tags.changing_table === 'yes'};
    }).filter(Boolean);
    facilityCache[key] = {fetched: Date.now(), entries};
    try { localStorage.setItem('parkpilot_break_facilities_v1', JSON.stringify(facilityCache)); } catch {}
  } catch (error) { facilityErrors[key] = error.message || 'Facilities unavailable'; }
  finally { facilityLoading[key] = false; if (state.park === key && tab === 'break') render(); }
}
function breakFacilities() {
  return (facilityCache[state.park]?.entries || []).filter(entry => breakCategory === 'all' || entry.category === breakCategory || (breakCategory === 'changing' && entry.changing)).map(entry => ({...entry, distance: mapOrigin ? distanceMeters(mapOrigin.coords, entry.coordinates) : null})).sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0) || a.name.localeCompare(b.name));
}
function facilityDirections(entry) {
  const params = new URLSearchParams({api: '1', destination: entry.coordinates.join(','), travelmode: 'walking'});
  if (mapOrigin) params.set('origin', mapOrigin.coords.join(','));
  return 'https://www.google.com/maps/dir/?' + params;
}
function viewBreakFinder() {
  const entries = breakFacilities(), isCalifornia = ['dl', 'ca'].includes(state.park), base = isCalifornia ? 'https://disneyland.disney.go.com' : 'https://disneyworld.disney.go.com';
  return `<div class="sectionhead"><h2>We need a break</h2></div>${parkSelect()}<div class="note">A practical pause for your family. Facility locations come from OpenStreetMap contributors; opening status, access and changing-table details may vary.</div><div class="journey-launchpad"><button class="btn" onclick="go('map')">${mapOrigin ? 'Change your start' : 'Set device or test location'}</button><button class="btn primary" onclick="loadBreakFacilities()" ${facilityLoading[state.park] ? 'disabled' : ''}>${facilityLoading[state.park] ? 'Finding facilities…' : 'Find park facilities'}</button></div><div class="chips">${[['water', 'Water'], ['restroom', 'Restrooms'], ['changing', 'Changing tables'], ['all', 'All facilities']].map(([value, label]) => `<button class="chip ${breakCategory === value ? 'active' : ''}" aria-pressed="${breakCategory === value}" onclick="breakCategory='${value}';render()">${label}</button>`).join('')}</div>${facilityErrors[state.park] ? `<p class="note">${ESC(facilityErrors[state.park])}. Try again later or use official park resources below.</p>` : ''}${officialBreakDirectory()}<div class="sectionhead"><h2>Community map locations</h2></div><div class="rides">${entries.slice(0, 30).map(entry => `<article class="ride"><h3>${ESC(entry.name)}</h3><p class="tag">${ESC(distanceLabel(entry.distance))}</p><p class="tiny muted">${entry.changing ? 'Changing table mapped · ' : ''}${entry.wheelchair ? 'Wheelchair tag: ' + ESC(entry.wheelchair) + ' · ' : ''}Community mapped; status unverified</p><a class="btn" href="${ESC(facilityDirections(entry))}" target="_blank" rel="noopener">Walking directions ↗</a><p class="tiny"><a href="${ESC(entry.source)}" target="_blank" rel="noopener">Map source ↗</a></p></article>`).join('') || `<div class="empty">${facilityLoading[state.park] ? 'Loading mapped facilities…' : facilityCache[state.park] ? 'No mapped facilities match this category. Check official resources below.' : 'Tap Find park facilities to load locations for this park.'}</div>`}</div><p class="foot">© OpenStreetMap contributors · ${facilityCache[state.park] ? 'Retrieved ' + new Date(facilityCache[state.park].fetched).toLocaleString() : 'Facilities are cached on this device after loading.'}</p><div class="sectionhead"><h2>Other ways to recharge</h2></div><a class="link-card" href="${base}/guest-services/${isCalifornia ? 'baby-center-lost-children' : 'baby-care-centers'}/" target="_blank" rel="noopener"><strong>Official Baby Care Centers ↗</strong><span class="tiny muted">Check locations, facilities and access with Disney.</span></a><button class="tool-row panel" onclick="go('dining')"><span>${icon('star')}</span><span><strong>Find something to eat</strong><small>Browse restaurants and Disney dining search</small></span>${icon('next')}</button><p class="foot">This finder requests facilities around the selected park, using the park center rather than sending your device coordinates to the facility service. Proximity is calculated on your device.</p>`;
}
function viewHeightMilestones() {
  const person = state.people.find(p => p.id === milestonePerson) || state.people[0];
  if (!person) return '<div class="empty">Add a family profile first.</div>';
  const measured = Number(person.height), catalog = placeCatalog[state.park] || [], matched = catalog.map(place => ({...heightRuleFor(place.name), name: place.name, rule: heightRuleFor(place.name)})).filter(entry => entry.rule);
  const records = matched.length ? matched.map(entry => ({...entry.rule, name: entry.name})) : (HEIGHT_DATA.parks[state.park] || []);
  const unique = [...new Map(records.map(entry => [normalize(entry.name), entry])).values()];
  const heights = [...new Set(unique.map(entry => entry.minimumInches))].sort((a, b) => a - b);
  const upcoming = heights.filter(height => height > measured).slice(0, 3), reached = unique.filter(entry => entry.minimumInches <= measured).length;
  return `<div class="sectionhead"><h2>Growing into the magic</h2></div>${parkSelect()}<label for="milestonePerson">Family member</label><select id="milestonePerson" class="field" onchange="milestonePerson=this.value;render()">${state.people.map(p => `<option value="${ESC(p.id)}" ${p.id === person.id ? 'selected' : ''}>${ESC(p.name)} · ${ESC(p.height)}″</option>`).join('')}</select><section class="panel journey-card"><span class="eyebrow">${ESC(person.name)}’s measured height</span><h2>${ESC(measured)} inches</h2><p>${reached} of ${unique.length} verified experiences meet the minimum height.</p><p class="tiny muted">Minimum-height milestones only. Companion, age, activity and operating requirements still apply. This chart does not predict growth or availability.</p>${heights.map(height => { const count = unique.filter(entry => entry.minimumInches === height).length; return `<div class="chart-row"><span>${height === 0 ? 'Any height' : height + '″ minimum'}</span><div class="chart-track"><div class="chart-bar ${height <= measured ? 'milestone-reached' : ''}" style="width:${count / Math.max(1, unique.length) * 100}%"></div></div><strong>${count}</strong></div>`; }).join('')}</section>${upcoming.map(height => `<section class="panel journey-card"><span class="eyebrow">Next milestone · ${(height - measured).toFixed(1).replace('.0', '')} inches away</span><h3>${height} inches</h3>${unique.filter(entry => entry.minimumInches === height).map(entry => `<p class="tiny"><a href="${ESC(entry.source)}" target="_blank" rel="noopener">${ESC(entry.name)} ↗</a></p>`).join('')}</section>`).join('') || '<p class="note">This profile meets every minimum height in the verified catalog. Check individual boarding conditions.</p>'}<button class="btn wide" onclick="go('family')">Update measured heights</button>${heightReference()}`;
}
let splitDraft = {riders: null, adultA: '', adultB: '', ride: '', meetup: '', time: ''};
function splitNames(ids) { return ids.map(id => state.people.find(p => p.id === id)?.name || 'Former family member').join(', '); }
function viewSplitPlanner() {
  if (!splitDraft.riders) splitDraft.riders = state.people.filter(p => p.selected).map(p => p.id);
  const selectedRide = live.find(r => r.id === splitDraft.ride), group = state.people.filter(p => splitDraft.riders.includes(p.id));
  const checked = selectedRide ? eligible(selectedRide, group.map(p => Number(p.height))) : null;
  return `<div class="sectionhead"><h2>Family split & meet-up</h2></div>${parkSelect()}${visitControls()}<p class="note">Coordinate two supervised groups, then reunite. This plan is saved on this device. Confirm Rider Switch arrangements and boarding requirements with a Cast Member.</p>${visitEntries(state.journey.splits).map(plan => `<section class="panel journey-card"><h3>${ESC(plan.rideName)}</h3><p><strong>Group A</strong> · ${ESC(splitNames(plan.groupA))}</p><p class="tiny muted">Responsible adult: ${ESC(splitNames([plan.adultA]))}</p><p><strong>Group B</strong> · ${ESC(splitNames(plan.groupB))}</p><p class="tiny muted">Responsible adult: ${ESC(splitNames([plan.adultB]))}</p><p class="tag">Meet ${ESC(plan.time)} · ${ESC(plan.meetup)}</p><div class="row wrap"><button class="miniBtn" onclick='toggleSplitReady(${safeId(plan.id)},"readyA")'>${plan.readyA ? '✓ A ready' : 'A ready to meet'}</button><button class="miniBtn" onclick='toggleSplitReady(${safeId(plan.id)},"readyB")'>${plan.readyB ? '✓ B ready' : 'B ready to meet'}</button><button class="miniBtn" onclick='shareSplit(${safeId(plan.id)})'>Copy/share plan</button><button class="miniBtn" aria-label="Delete split plan" onclick='deleteSplit(${safeId(plan.id)})'>×</button></div><p class="tiny muted">Readiness indicators are updated locally on this device.</p></section>`).join('')}<form class="panel journey-card" onsubmit="saveSplitPlan(event)"><h3>Create a supervised split</h3><label for="splitRide">Group A attraction</label><select class="field" id="splitRide" required onchange="captureSplitDraft();render()"><option value="">Choose a ride…</option>${live.map(ride => `<option value="${ESC(ride.id)}" ${ride.id === splitDraft.ride ? 'selected' : ''}>${ESC(ride.name)}</option>`).join('')}</select><p class="tiny muted">Select Group A riders. Everyone else is in Group B.</p>${state.people.map(p => `<label class="toggle"><span>${ESC(p.name)} · ${ESC(p.height)}″</span><input type="checkbox" name="splitRiders" value="${ESC(p.id)}" ${splitDraft.riders.includes(p.id) ? 'checked' : ''} onchange="captureSplitDraft();render()"></label>`).join('')}<p class="tag ${checked ? 'good' : 'warn'}">${!selectedRide ? 'Choose an attraction to check Group A heights' : checked ? 'Group A meets the checked height rule' : 'Review Group A heights and boarding conditions'}</p><div class="visit-controls"><div><label for="splitAdultA">Responsible adult in A</label><select class="field" id="splitAdultA" required onchange="captureSplitDraft()"><option value="">Choose an adult…</option>${state.people.map(p => `<option value="${ESC(p.id)}" ${splitDraft.adultA === p.id ? 'selected' : ''}>${ESC(p.name)}</option>`).join('')}</select></div><div><label for="splitAdultB">Responsible adult in B</label><select class="field" id="splitAdultB" required onchange="captureSplitDraft()"><option value="">Choose an adult…</option>${state.people.map(p => `<option value="${ESC(p.id)}" ${splitDraft.adultB === p.id ? 'selected' : ''}>${ESC(p.name)}</option>`).join('')}</select></div></div><label for="splitMeetup">Meet-up location</label><input class="field" id="splitMeetup" required maxlength="150" value="${ESC(splitDraft.meetup)}" oninput="captureSplitDraft()" placeholder="A clearly identified landmark"><label for="splitTime">Meet-up time · park local</label><input class="field" id="splitTime" type="time" required value="${ESC(splitDraft.time)}" onchange="captureSplitDraft()"><label class="toggle"><span>I confirm both named supervisors are responsible adults and will verify boarding and Rider Switch rules with Disney.</span><input type="checkbox" id="splitConfirm" required></label><p id="splitError" class="tiny" role="alert"></p><button class="btn primary wide">Save split plan</button></form>`;
}
function captureSplitDraft() {
  splitDraft = {riders: [...document.querySelectorAll('input[name="splitRiders"]:checked')].map(input => input.value), adultA: byId('splitAdultA')?.value || '', adultB: byId('splitAdultB')?.value || '', ride: byId('splitRide')?.value || '', meetup: byId('splitMeetup')?.value || '', time: byId('splitTime')?.value || ''};
}
function saveSplitPlan(event) {
  event.preventDefault(); captureSplitDraft();
  if (!byId('splitConfirm').checked) { byId('splitError').textContent = 'Confirm responsible adult supervision for both groups.'; return; }
  const groupA = state.people.filter(p => splitDraft.riders.includes(p.id)), groupB = state.people.filter(p => !splitDraft.riders.includes(p.id));
  if (!groupA.some(p => p.id === splitDraft.adultA) || !groupB.some(p => p.id === splitDraft.adultB)) { byId('splitError').textContent = 'Assign one responsible adult from each of the two groups.'; return; }
  const ride = live.find(r => r.id === splitDraft.ride);
  if (!ride) return;
  if (ride.height !== null && !eligible(ride, groupA.map(p => Number(p.height)))) { byId('splitError').textContent = 'Group A does not meet the checked height or companion rule. Update the groups or choose another attraction.'; return; }
  state.journey.splits.push({id: newEntryId(), park: state.park, date: state.journey.date, groupA: groupA.map(p => p.id), groupB: groupB.map(p => p.id), adultA: splitDraft.adultA, adultB: splitDraft.adultB, rideName: ride.name, meetup: splitDraft.meetup, time: splitDraft.time, readyA: false, readyB: false});
  splitDraft = {riders: null, adultA: '', adultB: '', ride: '', meetup: '', time: ''}; saveVisit();
}
function toggleSplitReady(id, key) { const plan = state.journey.splits.find(p => p.id === id); if (plan && ['readyA', 'readyB'].includes(key)) { plan[key] = !plan[key]; saveVisit(); } }
function deleteSplit(id) { state.journey.splits = state.journey.splits.filter(p => p.id !== id); saveVisit(); }
async function shareText(title, text) { if (navigator.share) { try { await navigator.share({title, text}); return; } catch (error) { if (error.name === 'AbortError') return; } } try { await navigator.clipboard.writeText(text); notify('Copied to clipboard'); } catch { notify('Sharing is unavailable in this browser'); } }
function shareSplit(id) { const plan = state.journey.splits.find(p => p.id === id); if (!plan) return; return shareText('ParkPilot family meet-up', `${plan.date} · ${PARKS.find(p => p.key === plan.park)?.name}\nGroup A: ${splitNames(plan.groupA)}\nGroup B: ${splitNames(plan.groupB)}\nMeet ${plan.time} at ${plan.meetup}\nAttraction: ${plan.rideName}`); }

function isVisitDone(id) {
  const completions = state.journey.memories.filter(m => m.attractionId === id && m.automatic);
  return completions.some(m => m.park === state.park && m.date === state.journey.date) || (state.done.includes(id) && completions.length === 0);
}
function recordCompletedAttraction(id, completed) {
  rememberPlace(id);
  if (!completed) { state.journey.memories = state.journey.memories.filter(m => !(m.automatic && m.attractionId === id && m.park === state.park && m.date === state.journey.date)); return; }
  if (visitEntries(state.journey.memories).some(m => m.automatic && m.attractionId === id)) return;
  state.journey.memories.push({id: newEntryId(), park: state.park, date: state.journey.date, title: savedPlace(id).name, note: '', recordedAt: new Date().toISOString(), type: 'ride', attractionId: id, automatic: true});
}
function photoDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(Error('Photo storage is unavailable in this browser'));
    const request = indexedDB.open('parkpilot_passport_v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('photos');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || Error('Photo storage could not open'));
  });
}
async function readPassportPhoto(key) {
  const db = await photoDatabase();
  try { return await new Promise((resolve, reject) => { const request = db.transaction('photos').objectStore('photos').get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
  finally { db.close(); }
}
async function writePassportPhotos(entries) {
  if (!entries.length) return;
  const db = await photoDatabase();
  try { await new Promise((resolve, reject) => { const transaction = db.transaction('photos', 'readwrite'); for (const [key, blob] of entries) transaction.objectStore('photos').put(blob, key); transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error || Error('Photo transaction cancelled')); }); }
  finally { db.close(); }
}
async function deletePassportPhoto(key) {
  if (!key) return;
  const db = await photoDatabase();
  try { await new Promise((resolve, reject) => { const transaction = db.transaction('photos', 'readwrite'); transaction.objectStore('photos').delete(key); transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); }); }
  finally { db.close(); }
  const url = passportPhotoURLs.get(key); if (url) { URL.revokeObjectURL(url); passportPhotoURLs.delete(key); }
}
async function prepareMemoryPhoto(file) {
  if (file.size > 20 * 1024 * 1024 || !file.type.startsWith('image/')) throw Error('Choose an image smaller than 20 MB');
  const url = URL.createObjectURL(file), image = new Image();
  try {
    image.src = url; await image.decode();
    const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight)), canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('Photo could not be processed')), 'image/jpeg', .82));
  } finally { URL.revokeObjectURL(url); }
}
function viewPassport() {
  const entries = visitEntries(state.journey.memories).slice().reverse(), rides = entries.filter(e => e.type === 'ride').length;
  return `<div class="sectionhead"><h2>Your park-day passport</h2></div>${parkSelect()}${visitControls()}<div class="passport-cover"><span class="eyebrow">A day worth remembering</span><h2>${ESC(activePark().name)}</h2><p>${ESC(state.journey.date)} · ${rides} completed attractions · ${entries.length} memories</p></div><div class="journey-launchpad"><button class="btn" onclick="sharePassport()">Share day recap</button><button class="btn" onclick="exportPassportDay()">Export day with photos</button></div><form class="panel journey-card" onsubmit="addPassportMemory(event)"><label for="memoryTitle">A favorite moment</label><input class="field" id="memoryTitle" maxlength="150" required placeholder="First ride, best snack, biggest smile…"><label for="memoryNote">Your story</label><textarea class="field" id="memoryNote" maxlength="5000" rows="3" placeholder="What made this moment special?"></textarea><label for="memoryPhoto">Optional photo · kept on this device</label><input class="field" id="memoryPhoto" type="file" accept="image/*"><p id="memoryError" class="tiny" role="alert"></p><button class="btn primary wide" id="saveMemory" ${memorySaving ? 'disabled' : ''}>${memorySaving ? 'Saving…' : 'Save this memory'}</button></form><div class="passport-timeline">${entries.map(entry => `<article class="panel journey-card">${entry.photoKey ? `<img class="memory-photo" data-passport-photo="${ESC(entry.photoKey)}" alt="${ESC(entry.title)}" hidden><p class="tiny muted" data-photo-status="${ESC(entry.photoKey)}">Loading saved photo…</p>` : ''}<span class="eyebrow">${entry.type === 'ride' ? 'Adventure completed' : 'A little moment'}</span><h3>${ESC(entry.title)}</h3>${entry.note ? `<p class="memory-note">${ESC(entry.note)}</p>` : ''}<p class="tiny muted">Recorded ${ESC(new Date(entry.recordedAt).toLocaleString())}</p><button class="miniBtn" onclick='deletePassportMemory(${safeId(entry.id)})'>Remove memory</button></article>`).join('') || '<div class="empty">Mark attractions done in My Plan or save your first moment here. Every great park day starts with one.</div>'}</div><p class="foot">Memories are local to this browser. Export a day or a JSON backup to keep a copy. Photos are resized for on-device storage.</p>`;
}
async function addPassportMemory(event) {
  event.preventDefault();
  if (memorySaving) return;
  const title = byId('memoryTitle').value.trim(), note = byId('memoryNote').value.trim(), file = byId('memoryPhoto').files?.[0], park = state.park, date = state.journey.date;
  if (!title) return;
  memorySaving = true;
  const button = byId('saveMemory'); button.disabled = true; button.textContent = 'Saving…';
  let photoKey;
  try {
    if (file) { const photo = await prepareMemoryPhoto(file); photoKey = newEntryId(); await writePassportPhotos([[photoKey, photo]]); }
    const entry = {id: newEntryId(), park, date, title, note, photoKey, recordedAt: new Date().toISOString(), type: 'memory'};
    state.journey.memories.push(entry);
    try { localStorage.setItem(STORE, JSON.stringify(state)); }
    catch (error) { state.journey.memories = state.journey.memories.filter(m => m.id !== entry.id); if (photoKey) await deletePassportPhoto(photoKey); throw error; }
    memorySaving = false; render(tab === 'passport' && state.park === park && state.journey.date === date); notify('Memory saved');
  } catch (error) { memorySaving = false; if (byId('memoryError')) byId('memoryError').textContent = error.message || 'Memory could not be saved'; if (button.isConnected) { button.disabled = false; button.textContent = 'Save this memory'; } }
}
async function mountPassportPhotos() {
  const images = [...document.querySelectorAll('img[data-passport-photo]')];
  for (const image of images) {
    const key = image.dataset.passportPhoto;
    try {
      let url = passportPhotoURLs.get(key);
      if (!url) { const blob = await readPassportPhoto(key); if (!blob) throw Error('Photo is not present on this device'); url = URL.createObjectURL(blob); passportPhotoURLs.set(key, url); }
      if (image.isConnected) { image.src = url; image.hidden = false; document.querySelector(`[data-photo-status="${CSS.escape(key)}"]`)?.remove(); }
    } catch { const status = document.querySelector(`[data-photo-status="${CSS.escape(key)}"]`); if (status) status.textContent = 'Photo is unavailable on this device. Restore a backup containing photos.'; }
  }
}
async function deletePassportMemory(id) {
  if (!confirm('Remove this saved memory and its photo from this device?')) return;
  const entry = state.journey.memories.find(m => m.id === id); if (!entry) return;
  const previous = state.journey.memories, previousDone = state.done;
  if (entry.automatic && entry.park === state.park && entry.date === state.journey.date) state.done = state.done.filter(value => value !== entry.attractionId);
  state.journey.memories = previous.filter(m => m.id !== id);
  try { localStorage.setItem(STORE, JSON.stringify(state)); }
  catch { state.journey.memories = previous; state.done = previousDone; return notify('Memory could not be removed'); }
  try { await deletePassportPhoto(entry.photoKey); } catch { notify('Memory removed; photo storage could not be cleaned'); }
  render();
}
function passportText() {
  const entries = visitEntries(state.journey.memories);
  return [`ParkPilot · ${activePark().name} · ${state.journey.date}`, ...entries.map(entry => `${entry.type === 'ride' ? '✓ ' : '★ '}${entry.title}${entry.note ? '\n' + entry.note : ''}`)].join('\n\n');
}
function sharePassport() { return shareText('Our Disney park day', passportText()); }
const blobDataURL = blob => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
function downloadLocal(name, blob) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
async function exportPassportDay() {
  try {
    const entries = visitEntries(state.journey.memories), sections = [];
    for (const entry of entries) {
      let photo = '';
      if (entry.photoKey) { const blob = await readPassportPhoto(entry.photoKey); if (blob) photo = `<img src="${await blobDataURL(blob)}" alt="${ESC(entry.title)}">`; }
      sections.push(`<article>${photo}<small>${entry.type === 'ride' ? 'Adventure completed' : 'A favorite moment'}</small><h2>${ESC(entry.title)}</h2><p>${ESC(entry.note || '')}</p></article>`);
    }
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Our ParkPilot day</title><style>body{font:17px system-ui;background:#07132d;color:#f8faff;max-width:760px;margin:auto;padding:24px}header,article{padding:24px;border:1px solid #647daa55;border-radius:20px;margin:18px 0;background:#10234d}small{color:#ffd35a}img{width:100%;border-radius:12px}p{white-space:pre-wrap;line-height:1.6}h1,h2{letter-spacing:-.03em}</style><header><small>PARKPILOT · OUR PARK-DAY PASSPORT</small><h1>${ESC(activePark().name)}</h1><p>${ESC(state.journey.date)}</p></header>${sections.join('') || '<p>A day ready for new memories.</p>'}</html>`;
    downloadLocal('ParkPilot-' + state.journey.date + '.html', new Blob([html], {type: 'text/html'}));
  } catch (error) { notify('Could not export this day: ' + error.message); }
}
async function exportBackup() {
  try {
    const photoData = {};
    for (const memory of state.journey.memories) { if (memory.photoKey && !photoData[memory.photoKey]) { const blob = await readPassportPhoto(memory.photoKey); if (blob) photoData[memory.photoKey] = await blobDataURL(blob); } }
    downloadLocal('parkpilot-backup-' + parkDate() + '.json', new Blob([JSON.stringify({app: 'ParkPilot', version: 2, exportedAt: new Date().toISOString(), preferences: state, photoData}, null, 2)], {type: 'application/json'})); notify('Backup includes saved passport photos');
  } catch (error) { notify('Backup failed: ' + error.message); }
}
async function restoreFile(event) {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    if (file.size > 100 * 1024 * 1024) throw Error('Choose a backup smaller than 100 MB');
    const payload = JSON.parse(await file.text()), preferences = payload.preferences;
    if (payload.app !== 'ParkPilot' || !preferences || !PARKS.some(p => p.key === preferences.park) || !Array.isArray(preferences.people) || !preferences.people.length || !Array.isArray(preferences.plan) || !Array.isArray(preferences.favorites) || preferences.people.some(p => !p || typeof p.name !== 'string' || !Number.isFinite(Number(p.height)) || Number(p.height) < 0 || Number(p.height) > 96)) throw Error('Invalid ParkPilot backup');
    if (!confirm('Replace current ParkPilot preferences and passport text with this backup?')) return;
    const restored = structuredClone(preferences), pendingPhotos = [];
    for (const [key, value] of Object.entries(payload.photoData || {})) {
      if (typeof value !== 'string' || value.length > 4000000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) throw Error('Invalid photo in backup');
      const newKey = newEntryId(), blob = await (await fetch(value)).blob();
      pendingPhotos.push([newKey, blob]);
      for (const memory of restored.journey?.memories || []) if (memory.photoKey === key) memory.photoKey = newKey;
    }
    await writePassportPhotos(pendingPhotos);
    const previous = state;
    state = {...DEFAULT, ...restored}; initializeJourney();
    try { localStorage.setItem(STORE, JSON.stringify(state)); }
    catch (error) { state = previous; for (const [key] of pendingPhotos) await deletePassportPhoto(key); throw error; }
    resetMapLocation(); render(); getLive(true); notify('Backup restored');
  } catch (error) { notify('Unable to import: ' + error.message); }
  finally { event.target.value = ''; }
}

function visitPlanText() {
  return [`ParkPilot · ${activePark().name} · ${state.journey.date}`, 'Must-dos:', ...priorityIds().map((id, index) => `${index + 1}. ${savedPlace(id).name}`), '', 'Saved attractions:', ...selectedPlan().map(id => `${isVisitDone(id) ? '✓' : '•'} ${savedPlace(id).name}`), '', 'Time commitments:', ...visitEntries(state.journey.appointments).map(a => `${a.time} · ${a.title} (${a.duration} min)`), '', 'Notes: ' + (state.notes || 'None')].join('\n');
}
async function exportPlan() {
  const text = visitPlanText();
  try { await navigator.clipboard.writeText(text); notify('Visit itinerary copied'); }
  catch { downloadLocal('parkpilot-itinerary.txt', new Blob([text], {type: 'text/plain'})); }
}
function toggleDetailPriority(id) {
  togglePriority(id);
  const button = byId('detailPriority');
  if (button) { const selected = priorityIds().includes(id); button.textContent = selected ? '★ Must-do for this visit' : '☆ Make a must-do'; button.setAttribute('aria-pressed', selected); }
}
function markDetailComplete(id) {
  doSet('done', id);
  const button = byId('detailComplete');
  if (button) button.textContent = isVisitDone(id) ? '✓ Added to passport' : 'Mark done & add to passport';
}
function resetSplitDraft() { splitDraft = {riders: null, adultA: '', adultB: '', ride: '', meetup: '', time: ''}; }
async function clearPassportStorage() {
  const db = await photoDatabase();
  try { await new Promise((resolve, reject) => { const transaction = db.transaction('photos', 'readwrite'); transaction.objectStore('photos').clear(); transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); }); }
  finally { db.close(); }
  for (const url of passportPhotoURLs.values()) URL.revokeObjectURL(url);
  passportPhotoURLs.clear();
}
try {
  const savedFacilities = JSON.parse(localStorage.getItem('parkpilot_break_facilities_v1') || '{}');
  for (const [key, value] of Object.entries(savedFacilities)) if (Number.isFinite(value.fetched) && Array.isArray(value.entries)) facilityCache[key] = value;
} catch {}

// Preserve in-progress reservation and memory drafts across live-feed re-renders.
function captureVisitForm() {
  const app = byId('app'), key = tab + ':' + visitKey();
  if (!app || app.dataset.formContext !== key) return null;
  const fields = ['reservationTitle','reservationTime','reservationDuration','reservationNotes','memoryTitle','memoryNote'];
  const values = fields.filter(id => byId(id)).map(id => ({id, value:byId(id).value, focused:document.activeElement===byId(id), start:byId(id).selectionStart, end:byId(id).selectionEnd}));
  const photo = byId('memoryPhoto');
  return {values, photo:photo?.files?.length ? photo : null};
}
function restoreVisitForm(snapshot) {
  byId('app').dataset.formContext = tab + ':' + visitKey();
  if (!snapshot) return;
  if (snapshot.photo && byId('memoryPhoto')) byId('memoryPhoto').replaceWith(snapshot.photo);
  for (const field of snapshot.values) {
    const input = byId(field.id); if (!input) continue;
    input.value = field.value;
    if (field.focused) { input.focus({preventScroll:true}); if (field.start !== null && ['text','textarea'].includes(input.type)) input.setSelectionRange(field.start,field.end); }
  }
}
