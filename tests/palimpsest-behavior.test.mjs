import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(inlineScript, 'The main inline script must exist');

function createHarness(seed = 5) {
  let elapsed = 0;
  let flashCount = 0;
  const events = new Map();
  const intervals = [];
  const frames = [];
  const storage = new Map([
    ['palimpsest-v1', JSON.stringify({ seed, lastAction: 0 })],
  ]);
  const noop = () => {};
  const ctx = new Proxy(
    { createRadialGradient: () => ({ addColorStop: noop }) },
    { get: (target, prop) => target[prop] ?? noop },
  );
  const nodes = {
    c: { width: 0, height: 0, getContext: () => ctx },
    input: { value: '', addEventListener: noop, focus: noop, blur: noop },
    whisper: { textContent: '', style: {} },
    flash: { animate: () => { flashCount += 1; } },
  };
  const globals = {
    Math,
    JSON,
    Date: { now: () => elapsed },
    performance: { now: () => elapsed },
    innerWidth: 390,
    innerHeight: 844,
    devicePixelRatio: 1,
    document: { getElementById: (id) => nodes[id] },
    window: {},
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    addEventListener: (name, fn) => events.set(name, fn),
    setInterval: (fn, ms) => intervals.push({ fn, ms }),
    requestAnimationFrame: (fn) => frames.push(fn),
  };
  runInNewContext(inlineScript, globals, { filename: 'index.html' });

  return {
    advance: (ms) => { elapsed += ms; },
    dispatch: (name, event = {}) => {
      assert.ok(events.has(name), 'Missing event: ' + name);
      events.get(name)(event);
    },
    interval: (ms) => {
      const item = intervals.find((entry) => entry.ms === ms);
      assert.ok(item, 'Missing interval: ' + ms);
      item.fn();
    },
    frame: () => {
      assert.ok(frames.length, 'No animation frame pending');
      frames.shift()(elapsed);
    },
    state: () => JSON.parse(storage.get('palimpsest-v1')),
    flashes: () => flashCount,
  };
}

function randomAfterThree(seed) {
  let value = seed;
  let r = 0;
  for (let i = 0; i < 3; i += 1) {
    value += 0.6180339887;
    const x = Math.sin(value) * 43758.5453;
    r = x - Math.floor(x);
  }
  return r;
}

test('the 23-action ritual fires only once while the action total is unchanged', () => {
  const app = createHarness();
  for (let i = 0; i < 23; i += 1) {
    app.dispatch('pointerdown', { clientX: 100, clientY: 100 });
    app.advance(20);
    app.dispatch('pointerup');
  }
  app.interval(2200);
  app.interval(5000);
  const first = app.state();
  assert.equal(first.touches, 23);
  assert.equal(first.lastRitualMilestone, 23);
  assert.equal(app.flashes(), 1);

  app.interval(2200);
  app.interval(5000);
  assert.equal(app.flashes(), 1);
  assert.equal(app.state().memory, first.memory);
  assert.equal(app.state().seed, first.seed);
});

test('autonomous glyphs do not count as user typing or reset idle time', () => {
  const seed = Array.from({ length: 100 }, (_, i) => i)
    .find((candidate) => Math.floor(randomAfterThree(candidate) * 4) === 2);
  assert.notEqual(seed, undefined, 'Need a deterministic autonomous glyph seed');
  const app = createHarness(seed);
  app.advance(10000);
  app.frame(); // triggers a world event: seeded branch choice 2 (glyph)
  app.interval(5000);
  assert.equal(app.state().words, 0);
  assert.equal(app.state().lastAction, 0);
  assert.notEqual(app.state().seed, seed);
});
