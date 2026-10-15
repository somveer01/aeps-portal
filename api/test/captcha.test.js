'use strict';

// The login captcha is fully black on its light background (letters and noise lines) - the owner asked for it.
// Guards against svg-captcha's random colours coming back.
const { test } = require('node:test');
const assert = require('node:assert');
const captcha = require('../src/services/captcha.service');

test('every captcha is black: letters and noise lines, never a colour', () => {
  for (let i = 0; i < 50; i += 1) {
    const { captchaId, svg } = captcha.generate();
    assert.ok(captchaId && svg.startsWith('<svg'), 'an svg comes back');
    const fills = [...svg.matchAll(/<path[^>]*fill="([^"]+)"/g)].map((m) => m[1]).filter((f) => f !== 'none');
    const strokes = [...svg.matchAll(/stroke="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(fills.length >= 5, 'the letters are there');
    assert.deepEqual([...new Set(fills)], ['#000000'], `letter colours: ${[...new Set(fills)]}`);
    if (strokes.length) assert.deepEqual([...new Set(strokes)], ['#000000'], `line colours: ${[...new Set(strokes)]}`);
  }
});

test('the answer still verifies once (the colour change does not touch the text)', () => {
  const { captchaId } = captcha.generate();
  assert.equal(captcha.verify(captchaId, 'wrong-answer'), false);
  assert.equal(captcha.verify(captchaId, 'anything'), false, 'single use: a second try with the same id fails');
});
