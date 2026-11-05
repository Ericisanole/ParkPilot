const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {test, beforeEach} = require('node:test');
const root = __dirname;
let context, elements;
function run(source) { return vm.runInContext(source, context); }
beforeEach(() => {
  elements = {};
  context = vm.createContext({crypto: require('node:crypto').webcrypto, URLSearchParams, Date, Intl,
    localStorage: {getItem: () => null, setItem: () => {}}, window: {},
    document: {getElementById: id => elements[id] || null, querySelectorAll: () => []}});
  for (const name of ['height-requirements.js', 'journey.js']) vm.runInContext(fs.readFileSync(root + '/' + name, 'utf8'), context);
  const source = fs.readFileSync(root + '/app.js', 'utf8');
  vm.runInContext(source.slice(0, source.indexOf("document.addEventListener('keydown'")), context);
  run(`render=()=>{};state.park='mk';state.journey.date='2026-11-05';state.people=[{id:'adultA',name:'Adult A',height:70,selected:true},{id:'adultB',name:'Adult B',height:65,selected:true},{id:'childA',name:'Child A',height:44,selected:true},{id:'childB',name:'Child B',height:34,selected:false}];state.done=[];state.plan=[];dataPark='mk';live=[makeRide({id:'pirates',name:'Pirates of the Caribbean',status:'OPERATING',queue:{STANDBY:{waitTime:10}}},'mk'),makeRide({id:'space',name:'Space Mountain',status:'OPERATING',queue:{STANDBY:{waitTime:20}}},'mk')];`);
});
test('Date and reservation calculations use the selected park timezone', () => {
  assert.equal(run("appointmentTimestamp({date:'2026-11-05',time:'14:30',park:'mk'})"), Date.parse('2026-11-05T19:30:00Z'));
  assert.equal(run("appointmentTimestamp({date:'2026-11-05',time:'14:30',park:'dl'})"), Date.parse('2026-11-05T22:30:00Z'));
  assert.equal(run("validVisitDate('2026-02-30')"), false);
  assert.equal(Number.isNaN(run("appointmentTimestamp({date:'2026-03-08',time:'02:30',park:'mk'})")), true);
});
test('Next activity honors must-dos, selected heights, operating status and missing waits', () => {
  assert.equal(run("nextActivities(new Date('2026-11-05T18:00:00Z'))[0].ride.id"), 'pirates');
  run("togglePriority('space')");
  assert.equal(run("nextActivities(new Date('2026-11-05T18:00:00Z'))[0].ride.id"), 'space');
  run("state.people.find(p=>p.id==='childB').selected=true");
  assert.equal(run("nextActivities(new Date('2026-11-05T18:00:00Z')).some(c=>c.ride.id==='space')"), false);
  run("live[0].wait=null");
  assert.equal(run("nextActivities(new Date('2026-11-05T18:00:00Z')).length"), 0);
});
test('Future visits have saved priorities without fabricating future waits', () => {
  run("state.journey.date='2026-11-06';togglePriority('space')");
  assert.equal(run("priorityIds()[0]"), 'space');
  assert.equal(run("nextActivities(new Date('2026-11-05T18:00:00Z')).length"), 0);
});
test('Reservation buffer and published closing time filter recommendations', () => {
  run("state.journey.appointments.push({park:'mk',date:'2026-11-05',time:'14:30',duration:60,title:'Lunch'})");
  assert.equal(run("nextActivities(new Date('2026-11-05T19:20:00Z')).length"), 0);
  run("state.journey.appointments=[];parkSchedules.mk=[{date:'2026-11-05',type:'OPERATING',openingTime:'2026-11-05T14:00:00Z',closingTime:'2026-11-05T19:10:00Z'}]");
  assert.equal(run("nextActivities(new Date('2026-11-05T19:05:00Z')).length"), 0);
});
test('An operating visit can continue after midnight', () => {
  run("parkSchedules.mk=[{date:'2026-11-05',type:'OPERATING',openingTime:'2026-11-05T14:00:00Z',closingTime:'2026-11-06T07:00:00Z'}]");
  assert.ok(run("nextActivities(new Date('2026-11-06T05:30:00Z')).length") > 0);
});
test('Completions are date-specific, idempotent and reversible', () => {
  run("doSet('done','pirates')");
  assert.equal(run("isVisitDone('pirates')"), true);
  run("recordCompletedAttraction('pirates',true)");
  assert.equal(run('state.journey.memories.length'), 1);
  run("state.journey.date='2026-11-06'");
  assert.equal(run("isVisitDone('pirates')"), false);
  run("doSet('done','pirates')");
  assert.equal(run('state.journey.memories.length'), 2);
  run("doSet('done','pirates')");
  assert.equal(run('state.journey.memories.length'), 1);
});
test('Proximity is geodesic distance and is labeled explicitly', () => {
  assert.equal(run('distanceMeters([28,-81],[28,-81])'), 0);
  assert.ok(run('distanceMeters([28,-81],[28.01,-81])') > 1100);
  assert.match(run('distanceLabel(200)'), /straight-line/);
});
test('Split plans require a supervisor in each group', () => {
  const field = value => ({value});
  Object.assign(elements, {splitRide: field('space'), splitAdultA: field('adultA'), splitAdultB: field('adultA'), splitMeetup: field('Main entrance'), splitTime: field('15:00'), splitConfirm: {checked: true}, splitError: {textContent: ''}});
  context.document.querySelectorAll = () => [{value: 'adultA'}, {value: 'childA'}];
  context.event = {preventDefault: () => {}};
  run('saveSplitPlan(event)');
  assert.match(elements.splitError.textContent, /one responsible adult/);
  assert.equal(run('state.journey.splits.length'), 0);
  elements.splitAdultB.value = 'adultB'; run('saveSplitPlan(event)');
  assert.equal(run('state.journey.splits.length'), 1);
});
test('Old preferences receive new fields without losing plans or notes', () => {
  run("state.journey=undefined;state.plan=['pirates'];state.notes='Lunch at noon';initializeJourney()");
  assert.equal(run("state.plan[0]"), 'pirates');
  assert.equal(run('state.notes'), 'Lunch at noon');
  assert.equal(run('Array.isArray(state.journey.memories)'), true);
});
test('Passport notes are escaped before rendering', () => {
  run("state.journey.memories.push({id:'example',park:'mk',date:'2026-11-05',type:'memory',title:'<script>alert(1)</script>',note:'<img src=x onerror=alert(1)>',recordedAt:'2026-11-05T18:00:00Z'})");
  const markup = run('viewPassport()');
  assert.ok(markup.includes('&lt;script&gt;'));
  assert.ok(!markup.includes('<script>alert'));
});
test('The offline asset graph includes both journey files', () => {
  const index = fs.readFileSync(root + '/index.html', 'utf8'), worker = fs.readFileSync(root + '/sw.js', 'utf8');
  assert.ok(index.indexOf('journey.js?v=journey1') < index.indexOf('app.js?v=journey1'));
  assert.ok(worker.includes('journey.js?v=journey1') && worker.includes('journey.css?v=journey1'));
});
