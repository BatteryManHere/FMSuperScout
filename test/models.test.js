// Modeltests voor FMSuperScout — draai met:  node --test
// Zero-dependency (node:test + node:assert), past bij de rest van de stack.
// We testen de ECHTE functies uit app/app.js via het harnas. Dit vangt regressies bij het
// bijstellen van de reken-modellen (waarde/interesse/potentie/rol) zonder handmatig herijken.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');

const M = loadApp();
// Vaste context i.p.v. localStorage/dump: peiljaar en valuta bekend maken.
M.state.cur = '£';
M.state.refYear = 2027;
M.state.refDoy = 1;
M.state.meta = { gameDate: '2027-01-01', gameYear: 2027, myClub: 'Testclub', myClubRep: 6000 };
M.state.players = [];

// Representatieve speler; velden zoals de plugin ze dumpt.
function player(over = {}) {
  return Object.assign({
    id: 1, name: 'Test Speler', birthYear: 2006, birthDoy: 1, age: 21,
    club: 'Andere Club', clubRep: 3000, worldRep: 2000, wage: 20000,
    ca: 120, pa: 150, pos: 'ST', posArr: ['ST'], nat: ['Netherlands'], foot: 'Rechts',
    value: 5_000_000, expires: '2028-06-30',
    attrs: {
      Finishing: 14, Passing: 11, Technique: 13, FirstTouch: 13, Dribbling: 12, Marking: 5, Tackling: 6,
      Composure: 13, Decisions: 12, Determination: 14, OffTheBall: 13, Anticipation: 12, WorkRate: 12,
      Pace: 15, Acceleration: 15, Strength: 12, Stamina: 13, Agility: 13, Balance: 12,
      Corners: 6, FreeKicks: 7,
      Consistency: 14, ImportantMatches: 12, InjuryProneness: 8, Versatility: 10, Dirtiness: 5,
    },
  }, over);
}

// ---------- parseMoney ----------
test('parseMoney: eenheden en randgevallen (£)', () => {
  assert.equal(M.parseMoney('10M'), 10_000_000);
  assert.equal(M.parseMoney('50K'), 50_000);
  assert.equal(M.parseMoney('1.8m'), 1_800_000);
  assert.equal(M.parseMoney('2mld'), 2_000_000_000);
  assert.equal(M.parseMoney('1,5M'), 1_500_000);   // komma als decimaal
  assert.equal(M.parseMoney(''), null);
  assert.equal(M.parseMoney('   '), null);
});

test('parseMoney: valuta terug naar interne GBP', () => {
  const near = (a, b) => Math.abs(a - b) < 1;   // deling geeft floating-point-ruis
  M.state.cur = '€';
  assert.ok(near(M.parseMoney('1.16M'), 1_000_000), '€1,16M → £1M');
  M.state.cur = '$';
  assert.ok(near(M.parseMoney('1.35M'), 1_000_000), '$1,35M → £1M');
  M.state.cur = '£';
  assert.equal(M.parseMoney('1M'), 1_000_000);
});

// ---------- monthsUntil ----------
test('monthsUntil: t.o.v. in-game datum', () => {
  assert.equal(M.monthsUntil(null), null);
  const half = M.monthsUntil('2027-07-01');   // ~6 maanden na 2027-01-01
  assert.ok(half > 5.5 && half < 6.5, `verwacht ~6, kreeg ${half}`);
  assert.ok(M.monthsUntil('2026-07-01') < 0, 'verleden = negatief');
});

// ---------- projectAttrs (potentie) ----------
test('projectAttrs: PA<=CA geeft geen projectie', () => {
  assert.equal(M.projectAttrs(player({ ca: 150, pa: 150 })), null);
  assert.equal(M.projectAttrs(player({ ca: 150, pa: 120 })), null);
});

test('projectAttrs: groeit, blijft <=20, laat verborgen kenmerken met rust', () => {
  const p = player({ ca: 100, pa: 160, age: 18 });
  const proj = M.projectAttrs(p);
  for (const k of Object.keys(p.attrs)) {
    if (['Consistency', 'ImportantMatches', 'Versatility', 'InjuryProneness', 'Dirtiness'].includes(k)) {
      assert.equal(proj[k], undefined, `verborgen kenmerk ${k} mag niet geprojecteerd worden`);
    } else {
      assert.ok(proj[k] >= p.attrs[k], `${k} mag niet dalen`);
      assert.ok(proj[k] <= 20, `${k} mag niet boven 20`);
    }
  }
});

test('projectAttrs: fysiek bevriest bij oudere speler, mentaal groeit door', () => {
  // Leeftijd via birthYear (getAge geeft birthYear voorrang boven het age-veld). refYear = 2027.
  const young = M.projectAttrs(player({ ca: 145, pa: 162, birthYear: 2005 }));   // 22
  const old = M.projectAttrs(player({ ca: 145, pa: 162, birthYear: 1996 }));     // 31
  const baseAttrs = player().attrs;
  const base = { attrs: baseAttrs };
  // Snelheidsgroei jong > oud (bij oud vrijwel bevroren)
  const paceGrowYoung = young.Pace - base.attrs.Pace;
  const paceGrowOld = old.Pace - base.attrs.Pace;
  assert.ok(paceGrowYoung >= paceGrowOld, 'jonge speler groeit fysiek minstens zo hard als oude');
  assert.ok(paceGrowOld <= 1, 'oude speler wint nauwelijks snelheid');
  // Mentale groei bij de oudere speler nog aanwezig
  assert.ok(old.Determination >= base.attrs.Determination, 'mentaal groeit ook op leeftijd');
});

// ---------- estValue ----------
test('estValue: echte in-game waarde komt er 1:1 uit (geen schatting)', () => {
  const ev = M.estValue(player({ value: 8_000_000 }));
  assert.equal(ev.v, 8_000_000);
  assert.equal(ev.est, false);
});

test('estValue: zonder echte waarde schat het een positief bereik', () => {
  const ev = M.estValue(player({ value: 0, worldRep: 4000 }));
  assert.equal(ev.est, true);
  assert.ok(ev.v == null || ev.v >= 0);
  // hogere reputatie => hogere schatting
  const lo = M.estValue(player({ value: 0, worldRep: 1000 }));
  const hi = M.estValue(player({ value: 0, worldRep: 7000 }));
  assert.ok(hi.v >= lo.v, 'meer reputatie => hogere schatting');
});

// ---------- interestEstimate ----------
test('interestEstimate: onbekende leeftijd wordt NIET als minderjarige behandeld', () => {
  const unknown = M.interestEstimate(player({ age: 0, birthYear: 0 }));
  assert.ok(unknown && unknown.note !== 'minor', 'age 0 mag geen minor-cap krijgen');
  assert.ok(unknown.score > 6, `onbekende leeftijd mag niet op minor-cap (6) blijven, kreeg ${unknown.score}`);
  const realMinor = M.interestEstimate(player({ age: 14, birthYear: 2013 }));
  assert.equal(realMinor.note, 'minor');
  assert.ok(realMinor.score <= 6);
});

test('interestEstimate: eigen speler => null', () => {
  assert.equal(M.interestEstimate(player({ club: 'Testclub' })), null);
});

// ---------- roleScore ----------
test('roleScore: betere attributen => hogere rolscore', () => {
  const roles = M.ROLES || [];
  assert.ok(roles.length, 'er zijn rollen gedefinieerd');
  const role = roles[0];
  const weak = player();
  const strong = player();
  for (const k of Object.keys(strong.attrs)) strong.attrs[k] = Math.min(20, weak.attrs[k] + 4);
  const sWeak = M.roleScore(weak, role);
  const sStrong = M.roleScore(strong, role);
  assert.ok(sStrong >= sWeak, `sterker profiel moet minstens even hoog scoren (${sStrong} vs ${sWeak})`);
});

test('historie: FM27 krijgt een eigen carrière-sleutel, FM26 houdt de kale managernaam', () => {
  const saved = M.state.meta;
  try {
    M.state.meta = { manager: 'Jan Jansen' };                  // oude dump zonder game-veld
    assert.equal(M.histKey(), 'Jan Jansen');
    M.state.meta = { manager: 'Jan Jansen', game: 'FM26' };
    assert.equal(M.histKey(), 'Jan Jansen');
    M.state.meta = { manager: 'Jan Jansen', game: 'FM27' };
    assert.equal(M.histKey(), 'Jan Jansen (FM27)');
    M.state.meta = {};
    assert.equal(M.histKey(), 'default');
  } finally { M.state.meta = saved; }
});

test('posities: natPos valt terug op posArr (oude dumps) en gebruikt posNat als die er is', () => {
  assert.deepEqual(M.natPos({ posArr: ['DC'] }), ['DC']);
  assert.deepEqual(M.natPos({ posArr: ['DC', 'DM'], posNat: ['DC'] }), ['DC']);
  assert.deepEqual(M.natPos({}), []);
});


test('bargainIndex: computes score between 1 and 99', () => {
  const p = player({ value: 2000000, attrs: { Pace: 16, Acceleration: 16 } });
  const bi = M.bargainIndex(p);
  assert.ok(bi >= 1 && bi <= 99, `Expected score between 1-99, got ${bi}`);
});

test('staffRoleScore: evaluates staff attributes', () => {
  const s = {
    jobId: 20,
    staffAttrs: {
      Oordeel_vermogen: 16, Oordeel_potentie: 16, 'Man-management': 15,
      Motiveren: 15, Tactische_kennis: 14, Vastberadenheid: 14,
    },
  };
  const sc = M.staffRoleScore(s);
  assert.ok(sc >= 14 && sc <= 20, `Expected AM score >= 14, got ${sc}`);
});

test('squadPlayersForPos: finds squad members sharing positions', () => {
  M.state.meta.myClub = 'Fenerbahçe A.Ş.';
  M.state.players = [
    { id: 10, name: 'Squad Striker', club: 'Fenerbahçe A.Ş.', posArr: ['ST'], ca: 140 },
    { id: 20, name: 'Squad Defender', club: 'Fenerbahçe A.Ş.', posArr: ['DC'], ca: 135 },
  ];
  const target = { id: 99, name: 'Target ST', club: 'Other Club', posArr: ['ST'] };
  const matches = M.squadPlayersForPos(target);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].name, 'Squad Striker');
});

test('modern tactical roles: all roles have valid attributes, labels and score properly', () => {
  const roles = M.ROLES;
  assert.ok(roles.length >= 40, `Expected 40+ tactical roles, got ${roles.length}`);
  const validAttrs = new Set(Object.keys(M.ATTR_LABEL.en));

  const expectedModernIds = ['iwb', 'ifb', 'pwb', 'cwb', 'nfb', 'ncb', 'wcb', 'lib', 'anchor', 'hb', 'regista', 'rpm', 'vol', 'mez', 'car', 'iw', 'wp', 'wtf', 'rd', 'ss', 'eng', 'tre', 'pf', 'dlf', 'f9'];
  for (const role of roles) {
    assert.ok(M.ROLE_LABEL.en[role.id], `Missing en label for ${role.id}`);
    assert.ok(M.ROLE_LABEL.nl[role.id], `Missing nl label for ${role.id}`);
    assert.ok(M.ROLE_LABEL.fr[role.id], `Missing fr label for ${role.id}`);
    assert.ok(M.ROLE_LABEL.de[role.id], `Missing de label for ${role.id}`);
    for (const k of role.key) assert.ok(validAttrs.has(k), `Invalid key attribute "${k}" in role ${role.id}`);
    for (const p of role.pref) assert.ok(validAttrs.has(p), `Invalid pref attribute "${p}" in role ${role.id}`);
  }

  for (const id of expectedModernIds) {
    const r = roles.find(x => x.id === id);
    assert.ok(r, `Modern role ${id} must be defined in ROLES`);
  }

  // Test role scoring for an Inverted Wing Back (IWB)
  const iwbRole = roles.find(x => x.id === 'iwb');
  const wbPlayer = player({
    posArr: ['DR', 'WBR'],
    attrs: { Passing: 15, Tackling: 14, WorkRate: 16, Decisions: 15, Teamwork: 15, Composure: 14, Stamina: 16, Positioning: 13, FirstTouch: 14, Vision: 14, Anticipation: 14, OffTheBall: 13, Pace: 15, Acceleration: 15 },
  });
  const iwbScore = M.roleScore(wbPlayer, iwbRole);
  assert.ok(iwbScore >= 13 && iwbScore <= 16, `Expected IWB score ~14-15, got ${iwbScore}`);
});


// ---------- teamchips binnen "Mijn club" ----------
// Verhuurde spelers horen bij het elftal van de moederclub (ownerTeamType), niet bij het
// elftal van de huurclub (teamType, bijna altijd 0). Praktijkgeval 05-11: Vanhoutte, reserves
// bij Feyenoord en verhuurd, stond onder "1e elftal".
test('inMyTeam: verhuurde speler telt bij zijn elftal bij de moederclub', () => {
  const my = 'feyenoord';
  const own0 = { club: 'Feyenoord', teamType: 0 };
  const own11 = { club: 'Feyenoord', teamType: 11 };
  const outRes = { club: 'Basaksehir', ownerClub: 'Feyenoord', teamType: 0, ownerTeamType: 3 };
  const outYouth = { club: 'FC Emmen', ownerClub: 'Feyenoord', teamType: 0, ownerTeamType: 11 };
  const outFirst = { club: 'FC Groningen', ownerClub: 'Feyenoord', teamType: 0, ownerTeamType: 0 };
  const outUnknown = { club: 'Almere', ownerClub: 'Feyenoord', teamType: 0 };
  const loanIn = { club: 'Feyenoord', ownerClub: 'Ajax', teamType: 0, ownerTeamType: 3 };
  const first = [own0, own11, outRes, outYouth, outFirst, outUnknown, loanIn].filter(p => M.inMyTeam(p, 'first', my));
  assert.deepEqual(first, [own0, outFirst, loanIn]);
  assert.ok(M.inMyTeam(outRes, 'res', my));
  assert.ok(M.inMyTeam(outYouth, 'youth', my));
  assert.ok(!M.inMyTeam(outRes, 'first', my));
  // Onbekend elftal: alleen onder "Alles", nergens anders.
  for (const sel of ['first', 'res', 'youth']) assert.ok(!M.inMyTeam(outUnknown, sel, my));
  assert.ok(M.inMyTeam(outUnknown, 'all', my));
  assert.equal(M.myTeamType(loanIn, my), 0);   // gehuurd: elftal waarin hij bij mij speelt
});

// ---------- transferakkoorden ----------
// Spelers met een akkoord gaan standaard uit de lijst, behalve als mijn club erbij betrokken is
// (eigen speler die vertrekt, speler die naar mij komt, of mijn speler die verhuurd is).
test('dealInvolvesMe: van, naar of eigendom van mijn club', () => {
  const my = 'feyenoord';
  assert.ok(M.dealInvolvesMe({ club: 'Feyenoord', transferTo: 'Parthenope' }, my));
  assert.ok(M.dealInvolvesMe({ club: 'Mallorca', transferTo: 'Feyenoord' }, my));
  assert.ok(M.dealInvolvesMe({ club: 'Emmen', ownerClub: 'Feyenoord', transferTo: 'Ajax' }, my));
  assert.ok(!M.dealInvolvesMe({ club: 'Mallorca', transferTo: 'Barcelona' }, my));
  assert.ok(!M.dealInvolvesMe({ club: 'Mallorca', transferTo: 'Barcelona' }, ''));

});


test('bestStaffFit: identifies best role for jobless staff without set job', () => {
  const joblessPhysio = {
    job: 'Staflid',
    staffAttrs: { Fysiotherapie: 18, Sportwetenschap: 12, Vastberadenheid: 14 },
  };
  const bestP = M.bestStaffFit(joblessPhysio);
  assert.ok(bestP, 'Should return best staff fit');
  assert.equal(bestP.g, 3); // Group 3 is Physio
  assert.ok(bestP.score >= 16);

  const joblessManager = {
    job: 'Staflid',
    staffAttrs: {
      Tactische_kennis: 18, 'Man-management': 18, Motiveren: 17,
      Vastberadenheid: 16, Oordeel_vermogen: 17, Oordeel_potentie: 17,
    },
  };
  const bestM = M.bestStaffFit(joblessManager);
  assert.ok(bestM, 'Should return best staff fit');
  assert.ok(bestM.g === 0 || bestM.g === 1); // Group 0 (Manager) or 1 (AM)
  assert.ok(bestM.score >= 16);
});


test('interestEstimate: staff exceeding club reputation considers club not competitive', () => {
  const eliteStaff = {
    name: 'Elite Manager',
    ca: 190, // Rep 10000 vs myClubRep 6000 -> statGap = -4000
    job: 'Manager',
    staffAttrs: { Aanpassingsvermogen: 18, Tactische_kennis: 18 },
  };
  const intElite = M.interestEstimate(eliteStaff);
  assert.equal(intElite.note, 'not_competitive');
  assert.ok(intElite.score <= 15);

  const foreignTopCoach = {
    name: 'Top Foreign Manager',
    ca: 155, // Rep ~9125 vs myClubRep 6000 -> statGap = -3125
    job: 'Staflid',
    nat: ['Argentina'],
    staffAttrs: { Aanpassingsvermogen: 16 },
  };
  const intForeign = M.interestEstimate(foreignTopCoach);
  assert.equal(intForeign.note, 'not_competitive');
  assert.ok(intForeign.score <= 15);

  const realisticStaff = {
    name: 'Realistic Coach',
    ca: 110, // Rep ~5750 vs myClubRep 6000 -> statGap = +250
    job: 'Coach',
    staffAttrs: { Aanpassingsvermogen: 15, Aanvallen: 14 },
  };
  const intReal = M.interestEstimate(realisticStaff);
  assert.ok(intReal.score >= 50);
});
