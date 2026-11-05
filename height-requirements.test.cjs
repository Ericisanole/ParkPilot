const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const root = __dirname;
const source = fs.readFileSync(root + '/app.js', 'utf8');
const startup = source.indexOf("document.addEventListener('keydown'");
assert.ok(startup > 0, 'Locate the application startup before evaluating pure rules');
const context = vm.createContext({localStorage: {getItem: () => null}, window: {}});
vm.runInContext(fs.readFileSync(root + '/height-requirements.js', 'utf8'), context);
vm.runInContext(source.slice(0, startup), context);

function rule(park, name) {
  context.parkKey = park;
  context.attractionName = name;
  return vm.runInContext('heightRuleFor(attractionName, parkKey)', context);
}
function matches(park, name, heights, recommendation = false) {
  const entry = rule(park, name);
  context.testRide = {height: entry?.minimumInches ?? null, heightRule: entry};
  context.testHeights = heights;
  context.forRecommendation = recommendation;
  return vm.runInContext('eligible(testRide, testHeights, forRecommendation)', context);
}

test('Shared names retain the correct park-specific rule', () => {
  assert.equal(rule('mk', 'Space Mountain').minimumInches, 44);
  assert.equal(rule('dl', 'Space Mountain').minimumInches, 40);
  assert.equal(rule('mk', 'Big Thunder Mountain Railroad').minimumInches, 38);
  assert.equal(rule('dl', 'Big Thunder Mountain Railroad').minimumInches, 40);
  assert.equal(rule('ca', "Goofy's Sky School").minimumInches, 42);
  assert.equal(rule('dl', "Goofy's How-to-Play Yard").minimumInches, 0);
});
test('Unrelated shows and unknown titles never inherit a substring match', () => {
  assert.equal(rule('ca', 'Guardians of the Galaxy: Awesome Dance Off!'), null);
  assert.equal(rule('ep', 'Space Mountain'), null);
  assert.equal(matches('ca', 'Unlisted experience', [70]), false);
  assert.equal(rule('ca', 'Guardians of the Galaxy - Mission: BREAKOUT!').minimumInches, 40);
});
test('The minimum boundary is inclusive and a fraction below is excluded', () => {
  assert.equal(matches('mk', 'Seven Dwarfs Mine Train', [38, 70]), true);
  assert.equal(matches('mk', 'Seven Dwarfs Mine Train', [37.99, 70]), false);
  assert.equal(matches('dl', 'Space Mountain', [40]), true);
  assert.equal(matches('dl', 'Space Mountain', [39.99]), false);
  assert.equal(matches('dl', 'Space Mountain', []), false);
  assert.equal(matches('dl', 'Space Mountain', [NaN]), false);
});
test('Autopia and Speedway check the accompanying rider height', () => {
  for (const [park, name] of [['dl', 'Autopia'], ['mk', 'Tomorrowland Speedway']]) {
    assert.equal(matches(park, name, [32, 54]), true);
    assert.equal(matches(park, name, [32, 53.99]), false);
    assert.equal(matches(park, name, [31.99, 70]), false);
    assert.equal(matches(park, name, [54]), true);
    assert.match(rule(park, name).notes, /54 inches/);
  }
});
test('Recommendations account for mission and swing variants', () => {
  assert.equal(matches('ep', 'Mission: SPACE', [40]), true);
  assert.equal(matches('ep', 'Mission: SPACE', [40], true), false);
  assert.equal(matches('ep', 'Mission: SPACE', [44], true), true);
  assert.equal(matches('ca', 'Silly Symphony Swings', [40, 70]), true);
  assert.equal(matches('ca', 'Silly Symphony Swings', [40, 70], true), false);
  assert.equal(matches('ca', 'Silly Symphony Swings', [48], true), true);
});
test('Redwood trail access does not imply unrestricted access to its activities', () => {
  assert.equal(matches('ca', 'Redwood Creek Challenge Trail', [20, 70]), true);
  assert.equal(matches('ca', 'Redwood Creek Challenge Trail', [50], true), false);
  assert.match(rule('ca', 'Redwood Creek Challenge Trail').notes, /42–63/);
  assert.match(rule('ca', 'Redwood Creek Challenge Trail').notes, /12 or younger/);
});
test('Every bundled record has an official source and verified date', () => {
  const data = vm.runInContext('PARKPILOT_HEIGHTS', context);
  assert.equal(data.verifiedOn, '2026-11-05');
  assert.equal(Object.keys(data.parks).length, 6);
  for (const entries of Object.values(data.parks)) {
    for (const entry of entries) {
      assert.ok(Number.isInteger(entry.minimumInches) && entry.minimumInches >= 0);
      assert.ok(['disneyworld.disney.go.com', 'disneyland.disney.go.com'].includes(new URL(entry.source).hostname));
    }
  }
});
test('An in-flight response uses its own park when the selected park changes', () => {
  vm.runInContext("state.park='ca'", context);
  const height = vm.runInContext("makeRide({name:'Space Mountain'},'mk').height", context);
  assert.equal(height, 44);
});
