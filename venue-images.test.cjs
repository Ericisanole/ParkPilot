const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const context=vm.createContext({});
vm.runInContext(fs.readFileSync(__dirname+'/venue-images.js','utf8'),context);
const get=(name,park)=>{context.name=name;context.park=park;return vm.runInContext('curatedVenueImage(name,park)',context)};
test('Shared attraction names resolve to the selected park and never a different resort',()=>{
 assert.equal(get('Space Mountain','mk').park,'mk');assert.equal(get('Space Mountain','dl').park,'dl');
 assert.notEqual(get('Space Mountain','mk').atlas,get('Space Mountain','dl').atlas);
 assert.equal(get('Space Mountain','ep'),null);
 assert.equal(get('Dumbo the Flying Elephant','dl'),null);
 assert.equal(get('Autopia','dl'),null);
});
test('Punctuation and explicitly reviewed aliases match without fuzzy title guesses',()=>{
 assert.ok(get('TRON Lightcycle / Run','mk'));
 assert.ok(get('Guardians of the Galaxy – Mission: BREAKOUT!','ca'));
 assert.ok(get("Remy’s Ratatouille Adventure",'ep'));
 assert.equal(get("Soarin' Across America",'ep'),null);
 assert.equal(get('Space Mountain Gift Shop','mk'),null);
});
test('Every bundled crop has a valid local collection, source, creator, license and unique park/title',()=>{
 const rows=vm.runInContext('VENUE_IMAGES',context),keys=new Set();
 assert.ok(rows.length>100);
 for(const p of rows){
  const key=p.park+':'+p.name;assert.ok(!keys.has(key));keys.add(key);
  assert.match(p.source,/^https:\/\/commons.wikimedia.org\/wiki\/File:/);
  assert.ok(p.artist);assert.match(p.license,/^(CC BY|CC0|Public domain|PD)/);
  assert.match(p.licenseUrl,/^https:\/\//);
  assert.ok(fs.existsSync(__dirname+'/'+p.atlas));assert.ok(p.row<p.rows && p.column<p.columns);
 }
});
test('Offline app graph loads the image module before rendering and exposes permanent credits',()=>{
 const index=fs.readFileSync(__dirname+'/index.html','utf8'),sw=fs.readFileSync(__dirname+'/sw.js','utf8'),app=fs.readFileSync(__dirname+'/app.js','utf8');
 assert.ok(index.indexOf('venue-images.js?v=photos1')<index.indexOf('app.js?v=photos1'));
 assert.match(sw,/venue-image-credits.html/);assert.match(sw,/venue-images.js\?v=photos1/);
 assert.doesNotMatch(app,/choosePhoto\(/);assert.doesNotMatch(app,/Find a photo/);
 assert.match(app,/const photo=photos\[id\]/);
});
