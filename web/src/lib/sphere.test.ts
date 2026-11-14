import assert from 'node:assert/strict';
import test from 'node:test';
import { angle, ecliptic, galactic, offset, project, radec, toRadec, unproject } from './sphere.ts';

const near = (a: number, b: number, tol = 1e-3) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);

test('ecliptic and galactic planes land where the catalogues put them', () => {
  // the north ecliptic pole is 90° from every ecliptic point; our NEP field sits on it
  const nep = radec(270, 66.5607);
  for (const lon of [0, 45, 90, 200]) near(angle(nep, ecliptic(lon)), 90, 1e-3);
  const gc = toRadec(galactic(0, 0));
  near(gc.ra, 266.405, 2e-3);
  near(gc.dec, -28.936, 2e-3);
  const ngp = toRadec(galactic(0, 90));
  near(ngp.ra, 192.859, 2e-3);
  near(ngp.dec, 27.128, 2e-3);
});

test('inside view puts east on the left and round-trips through unproject', () => {
  const v = { ra: 120, dec: 30 };
  const [x0, y0, z0] = project(radec(120, 30), v);
  near(x0, 0);
  near(y0, 0);
  near(z0, 1);
  assert.ok(project(radec(121, 30), v)[0] < 0, 'higher RA (east) is left');
  assert.ok(project(radec(120, 31), v)[1] > 0, 'north is up');
  const [x, y] = project(radec(135, 10), v);
  const back = unproject(x, y, v);
  assert.ok(back);
  near(back.ra, 135);
  near(back.dec, 10);
  assert.equal(unproject(0.9, 0.9, v), null);
});

test('tangent offsets are small-angle accurate', () => {
  near(angle(offset(270, 66.5, 0.125, 0), radec(270, 66.5)), 0.125, 1e-4);
});
