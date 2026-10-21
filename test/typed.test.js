// Typed data (2.0 slice 3): numbers, yes/no, dates, choices and links, as rules. Read these to learn how typed values behave.
'use strict';
const assert = require('assert');
const { load, rule, run, exactOf } = require('./harness');
const PF = load(), V = PF.values;
const same = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);
const NUM = { kind: 'number', label: 'amount' }, YN = { kind: 'yes-no', label: 'approved' }, DATE = { kind: 'date', label: 'due' }, LINK = { kind: 'url', label: 'runbook' };
const CHOICE = { kind: 'choice', label: 'environment', options: ['dev', 'test', 'prod'] };

/* ---------- PF.values ---------- */

rule('A number is stored as an exact decimal: signs, leading zeros and trailing zeros are written one way, and every zero is 0', () => {
  const c = (raw) => V.parse(NUM, raw).canonical;
  assert.strictEqual(c('12'), '12');
  assert.strictEqual(c('+12'), '12');
  assert.strictEqual(c('007'), '7');
  assert.strictEqual(c('3.50'), '3.5');
  assert.strictEqual(c('-1.0'), '-1');
  ['0', '-0', '+0', '0.0', '-0.00', '000'].forEach(z => assert.strictEqual(c(z), '0', z));
  assert.strictEqual(c('9007199254740993'), '9007199254740993', 'never rounded through a JavaScript number');
  assert.strictEqual(c('-1234567890123456789.123456789'), '-1234567890123456789.123456789');
});

rule('A number with an exponent, grouping, inner spaces or anything else is refused with "Type a number"', () => {
  ['1e3', '1E3', '1e999', 'NaN', 'Infinity', '-Infinity', '1,234', '1 234', '1.2.3', '.5', '5.', '12a', '0x10', '--1', '+-1', '١٢'].forEach(raw => {
    const p = V.parse(NUM, raw);
    assert.ok(!p.ok, raw);
    assert.strictEqual(p.why, 'Type a number, like 12 or 3.5.', raw);
  });
});

rule('A number may be at most 30 characters; 31 is refused', () => {
  assert.ok(V.parse(NUM, '1'.repeat(30)).ok);
  assert.ok(!V.parse(NUM, '1'.repeat(31)).ok);
  assert.ok(V.parse(NUM, '-' + '1'.repeat(29)).ok);
  assert.ok(!V.parse(NUM, '-' + '1'.repeat(30)).ok);
});

rule('Surrounding Unicode white space is trimmed (no-break and ideographic spaces too), never inside a value', () => {
  assert.strictEqual(V.parse(NUM, '  12　').canonical, '12');
  assert.strictEqual(V.parse(NUM, ' -3.5 ').canonical, '-3.5');
  assert.ok(!V.parse(NUM, '1 234').ok, 'a no-break space inside a number is refused');
  assert.strictEqual(V.parse({ kind: 'text' }, '　a b ').canonical, 'a b');
});

rule('Numbers compare exactly, digit by digit, never through floating point', () => {
  assert.strictEqual(V.compare('9007199254740993', '9007199254740992'), 1);
  assert.strictEqual(V.compare('0.1', '0.10000000000000001'), -1);
  assert.strictEqual(V.compare('-2', '-10'), 1);
  assert.strictEqual(V.compare('-0.5', '0'), -1);
  assert.strictEqual(V.compare('12.5', '12.5'), 0);
  assert.strictEqual(V.compare('100', '99.999'), 1);
});

rule('A number definition\'s min and max are checked exactly, and its unit never enters the value', () => {
  const d = { kind: 'number', label: 'rows', min: '0', max: '0.3', unit: 'GB' };
  assert.ok(V.parse(d, '0.3').ok);
  assert.ok(V.parse(d, '0').ok);
  assert.ok(!V.parse(d, '0.30000000000000001').ok);
  assert.strictEqual(V.parse(d, '-1').why, 'Rows can\'t be less than 0.');
  assert.strictEqual(V.parse(d, '0.3').canonical, '0.3');
});

rule('Yes/no is stored as yes or no; anything else is refused', () => {
  assert.strictEqual(V.parse(YN, 'Yes').canonical, 'yes');
  assert.strictEqual(V.parse(YN, ' NO ').canonical, 'no');
  ['y', 'true', '1', 'maybe'].forEach(x => assert.ok(!V.parse(YN, x).ok, x));
});

rule('A date is a real calendar date, YYYY-MM-DD, never read through Date', () => {
  assert.ok(V.parse(DATE, '2028-02-29').ok, 'leap year');
  assert.ok(!V.parse(DATE, '2026-02-29').ok, 'not a leap year');
  assert.ok(!V.parse(DATE, '2100-02-29').ok, 'centuries are not leap years');
  assert.ok(V.parse(DATE, '2000-02-29').ok, 'every 400 years is');
  ['2026-02-30', '2026-13-01', '2026-00-10', '26-10-31', '2026-1-5', '10/31/2026', '2026-10-31T00:00', '0000-01-01'].forEach(x => assert.ok(!V.parse(DATE, x).ok, x));
  assert.strictEqual(V.parse(DATE, '2026-10-31').why, undefined);
  assert.strictEqual(V.parse(DATE, 'next Tuesday').why, 'Pick a date.');
});

rule('A date shows as the same calendar day in every time zone', () => {
  const saved = process.env.TZ;
  ['America/Los_Angeles', 'Pacific/Kiritimati', 'UTC'].forEach(tz => {
    process.env.TZ = tz;
    assert.strictEqual(V.show(DATE, '2026-01-01'), 'Jan 1, 2026', tz);
    assert.strictEqual(V.show(DATE, '2026-12-31'), 'Dec 31, 2026', tz);
  });
  process.env.TZ = saved;
});

rule('A link starts with http:// or https://; mailto:, javascript: and anything else is refused', () => {
  assert.ok(V.parse(LINK, 'https://example.com/a').ok);
  assert.ok(V.parse(LINK, 'http://example.com').ok);
  ['mailto:a@example.com', 'javascript:alert(1)', 'example.com', 'https://', 'https://exa mple.com', 'ftp://example.com', 'https://example.com/"><b>'].forEach(x => assert.ok(!V.parse(LINK, x).ok, x));
  assert.strictEqual(V.parse(LINK, 'mailto:a@example.com').why, 'Type a web link that starts with https://.');
});

rule('A choice is stored as the option\'s own spelling; a case-insensitive match is accepted when typed', () => {
  assert.strictEqual(V.parse(CHOICE, 'PROD').canonical, 'prod');
  assert.ok(!V.parse(CHOICE, 'staging').ok);
  assert.ok(V.valid(CHOICE, 'prod'));
  assert.ok(!V.valid(CHOICE, 'PROD'), 'a stored value in another spelling isn\'t canonical, so it is flagged, never coerced');
});

rule('Options that differ only in capitals are a clash for a new choice', () => {
  same(V.foldClash(['dev', 'test', 'DEV']), ['dev', 'DEV']);
  assert.strictEqual(V.foldClash(['dev', 'test']), null);
});

rule('A stored value is valid only when it is exactly canonical; empty means not answered', () => {
  assert.ok(V.valid(NUM, '12.5'));
  assert.ok(V.valid(NUM, ''));
  ['12.50', '+1', '-0', ' 12', '1e3', '012'].forEach(x => assert.ok(!V.valid(NUM, x), x));
  [null, undefined, 12, true, {}, []].forEach(x => assert.ok(!V.valid(NUM, x), String(x)));
  assert.strictEqual(V.invalidWhy(NUM, '12a'), 'Not a number: "12a". Fill in to correct it.');
});

rule('Hostile values never throw and are never valid numbers, dates or yes/no', () => {
  const hostile = [NaN, Infinity, -Infinity, 1e999, -0, 2 ** 53 + 1, null, undefined, true, {}, [], { toString: null }, Object.create(null), '__proto__', 'constructor'];
  [NUM, YN, DATE, LINK, CHOICE].forEach(d => hostile.forEach(h => {
    assert.ok(!V.valid(d, h) || h === '' , d.kind + ' ' + String(typeof h));
    assert.doesNotThrow(() => V.migrate(d, h));
    assert.doesNotThrow(() => V.show(d, h));
    assert.doesNotThrow(() => V.json(d, h));
  }));
  const proto = { kind: 'choice', label: 'x', options: ['constructor', '__proto__'] };
  assert.strictEqual(V.parse(proto, 'Constructor').canonical, 'constructor');
  assert.ok(!V.parse(proto, 'toString').ok);
});

rule('Numbers show grouped and never rounded; yes/no shows Yes or No; long numbers are grouped by hand', () => {
  assert.strictEqual(V.show(NUM, '1234.5'), '1,234.5');
  assert.strictEqual(V.show(NUM, '-1234567'), '-1,234,567');
  assert.strictEqual(V.show(NUM, '9007199254740993'), '9,007,199,254,740,993');
  assert.strictEqual(V.show(NUM, '0.000000000000000001'), '0.000000000000000001');
  assert.strictEqual(V.both(NUM, '1234.5'), '1,234.5 (1234.5)');
  assert.strictEqual(V.both(NUM, '12'), '12');
  assert.strictEqual(V.show(YN, 'yes'), 'Yes');
  assert.strictEqual(V.show(NUM, '12a'), '12a', 'an invalid value shows as written');
});

rule('For other apps, numbers are strings, yes/no a boolean, and an empty or invalid value null', () => {
  assert.strictEqual(V.json(NUM, '9007199254740993'), '9007199254740993');
  assert.strictEqual(V.json(YN, 'no'), false);
  assert.strictEqual(V.json(DATE, '2026-10-31'), '2026-10-31');
  assert.strictEqual(V.json(NUM, ''), null);
  assert.strictEqual(V.json(NUM, '12a'), null);
});

rule('Old text meets a typed definition: canonical is exact, an unambiguous spelling converts, everything else is never guessed', () => {
  const m = (d, t) => { const x = V.migrate(d, t); return x.verdict + (x.result != null ? ':' + x.result : ''); };
  assert.strictEqual(m(NUM, '1234.5'), 'exact:1234.5');
  assert.strictEqual(m(NUM, ' 1234.50 '), 'converted:1234.5');
  assert.strictEqual(m(NUM, '007'), 'converted:7');
  assert.strictEqual(m(NUM, '1,234'), 'ambiguous');
  assert.strictEqual(m(NUM, '1.234,5'), 'ambiguous');
  assert.strictEqual(m(NUM, 'about ten'), 'invalid');
  ['yes', 'Y', 'TRUE', 'true'].forEach(x => assert.strictEqual(m(YN, x), x === 'yes' ? 'exact:yes' : 'converted:yes', x));
  ['N', 'false', 'no'].forEach(x => assert.ok(/:no$/.test(m(YN, x)), x));
  assert.strictEqual(m(YN, 'maybe'), 'invalid');
  assert.strictEqual(m(DATE, '03/04/2026'), 'ambiguous');
  assert.strictEqual(m(DATE, 'next Tuesday'), 'ambiguous');
  assert.strictEqual(m(DATE, '2026-10-31'), 'exact:2026-10-31');
  assert.strictEqual(m(CHOICE, 'Prod'), 'converted:prod');
  assert.strictEqual(m({ kind: 'choice', options: ['prod', 'PROD'] }, 'Prod'), 'ambiguous', 'a value matching two options ignoring case is ambiguous');
  assert.strictEqual(m(CHOICE, 'staging'), 'invalid');
  assert.strictEqual(m(LINK, 'mailto:a@example.com'), 'invalid');
  assert.strictEqual(m(LINK, 'https://example.com'), 'exact:https://example.com');
  assert.strictEqual(V.ask(DATE, '03/04/2026'), 'Before: "03/04/2026" (text). Pick the date it means.');
  assert.strictEqual(V.ask(NUM, '1,234'), 'Before: "1,234" (text). Type the number it means.');
});

/* ---------- Checklist syntax: typed run details and evidence ---------- */
const M = PF.map, P = PF.publish, E = PF.envelope, T = PF.types;
const HEAD = (ctx, extra) => ['---', 'process: typed', 'title: Typed', 'context: ' + ctx].concat(extra || []).concat(['---', '', '## One · READ-DO {#one}', '- [!] {confirm} Look ^amount {#look}', '']).join('\n');
const TYPED = 'ticket, amount:number, due:date, approved:yes-no, environment:choice(dev|test|prod), runbook:link';

rule('Typed run details are declared in context: as name:kind; names stay the run detail names and bindings use the bare name', () => {
  const m = M.parse(HEAD(TYPED));
  same(m.meta.context, ['ticket', 'amount', 'due', 'approved', 'environment', 'runbook']);
  same(m.meta.detailTypes, { amount: { kind: 'number' }, due: { kind: 'date' }, approved: { kind: 'yes-no' }, environment: { kind: 'choice', options: ['dev', 'test', 'prod'] }, runbook: { kind: 'link' } });
  assert.strictEqual(Object.getPrototypeOf(m.meta.detailTypes), null, 'keys from a file never find something inherited');
  same(M.check(m).blockers, []);
  same(M.features(m), ['typed-details']);
});

rule('A checklist without typed details parses and checks exactly as before: no detail types and no 2.0 feature', () => {
  const m = M.parse(HEAD('ticket, amount'));
  same(m.meta.detailTypes, {});
  same(M.features(m), []);
  same(M.check(m).blockers, []);
});

rule('A typed run detail declaration that isn\'t right is an error on the context line, naming what to fix', () => {
  const errs = (ctx) => M.parse(HEAD(ctx)).errors.map(e => e.line + ': ' + e.msg);
  same(errs('ticket:text'), ['4: Run detail "ticket" is text already; write just ticket.']);
  same(errs('amount:numbr'), ['4: Run detail "amount": "numbr" isn\'t a kind. Use number, yes-no, date, link or choice(a|b).']);
  same(errs('env:choice(dev)'), ['4: Run detail "env": a choice needs at least two options, like choice(dev|prod).']);
  same(errs('env:choice(dev|DEV)'), ['4: Run detail "env": dev and DEV differ only in capitals; keep one.']);
  same(errs('env:choice(dev| test)'), ['4: Run detail "env": the option " test" starts or ends with a space; remove it.']);
  same(errs('env:choice(a:b|c)'), ['4: Run detail "env": the option "a:b" has ":", which an option can\'t hold.']);
  same(errs('env:choice(dev|)'), ['4: Run detail "env": an option is empty.']);
  same(errs('env:choice(dev|prod'), ['4: Run detail "env": "choice(dev|prod" isn\'t a kind. Use number, yes-no, date, link or choice(a|b).']);
  assert.ok(errs('env:choice(' + Array.from({ length: 21 }, (_, i) => 'o' + i).join('|') + ')')[0].indexOf('at most 20 options') > 0);
  assert.ok(errs('env:choice(' + 'x'.repeat(41) + '|b)')[0].indexOf('at most 40 characters') > 0);
  same(errs('amount:number, amount:date'), ['4: Run detail "amount" is listed twice; list it once.']);
  same(errs('amount, amount:number'), ['4: Run detail "amount" is listed twice; list it once.']);
  same(errs('amount:number, amount'), ['4: Run detail "amount" is listed twice; list it once.']);
  same(errs('amount, amount'), [], 'two bare duplicates stay allowed, as before');
  same(errs('amount:number:number'), ['4: Run detail "amount": "number:number" isn\'t a kind. Use number, yes-no, date, link or choice(a|b).']);
  assert.ok(M.check(M.parse(HEAD('__proto__:number'))).blockers.some(b => /keeps for itself/.test(b)));
  assert.ok(M.check(M.parse(HEAD('constructor:yes-no'))).blockers.some(b => /keeps for itself/.test(b)));
});

rule('A plain step can ask for a number, yes/no or date as its evidence; that is typed evidence', () => {
  const md = HEAD('ticket, amount').replace('{#look}', '{#look}\n  evidence: number');
  const m = M.parse(md);
  same(M.check(m).blockers, []);
  same(M.features(m), ['typed-evidence']);
  ['yes-no', 'date'].forEach(k => same(M.features(M.parse(HEAD('ticket, amount').replace('{#look}', '{#look}\n  evidence: ' + k))), ['typed-evidence'], k));
  same(M.features(M.parse(HEAD('ticket').replace('{#look}', '{#look}\n  evidence: link'))), []);
});

/* ---------- Step types with typed evidence ---------- */
const TYPE2 = { format: 'flightdeck-step-type/2', features: ['typed-evidence'], app: '2.0.0', id: 'team.count', label: 'Count rows', icon: 'doc', hint: 'Counts the rows in a restored copy.',
  fields: { system: { label: 'System', kind: 'text' } }, record: [{ name: 'rows', label: 'Rows', kind: 'number', min: '0' }, { name: 'matches', label: 'Matches the source', kind: 'yes-no' }] };
const plain = (o) => JSON.parse(JSON.stringify(o));

rule('A team step type may record a number, yes/no or date when its file says it is a 2.0 step type', () => {
  same(T.checkCustom(TYPE2), []);
  const bare = plain(TYPE2); delete bare.format; delete bare.features; delete bare.app;
  same(T.checkCustom(bare), ['record 1: number evidence needs Flightdeck 2.0; add "format": "flightdeck-step-type/2" and "features": ["typed-evidence"] to the file', 'record 2: yes-no evidence needs Flightdeck 2.0; add "format": "flightdeck-step-type/2" and "features": ["typed-evidence"] to the file']);
  const date = plain(TYPE2); date.record = [{ name: 'when', label: 'When', kind: 'date' }];
  same(T.checkCustom(date), []);
});

rule('A number\'s min, max and unit are checked; only a number has them', () => {
  const t = (rec) => T.checkCustom(Object.assign(plain(TYPE2), { record: [rec] }));
  same(t({ name: 'rows', label: 'Rows', kind: 'number', min: '0', max: '10', unit: 'rows' }), []);
  same(t({ name: 'rows', label: 'Rows', kind: 'number', min: 0 }), ['record 1: "min" must be a number written as text, like "0" or "12.5"']);
  same(t({ name: 'rows', label: 'Rows', kind: 'number', min: '1e3' }), ['record 1: "min" must be a number written as text, like "0" or "12.5"']);
  same(t({ name: 'rows', label: 'Rows', kind: 'number', min: '5', max: '1' }), ['record 1: "min" is more than "max"']);
  same(t({ name: 'rows', label: 'Rows', kind: 'number', unit: 'x'.repeat(21) }), ['record 1: "unit" must be 1-20 characters']);
  same(t({ name: 'ok', label: 'OK', kind: 'yes-no', unit: 'GB' }), ['record 1: only a number has "min", "max" and "unit"']);
  same(t({ name: 'ok', label: 'OK', kind: 'text', max: '3' }), ['record 1: only a number has "min", "max" and "unit"']);
});

rule('A 2.0 step type\'s choices can\'t differ only in capitals; a 1.x-shaped file keeps today\'s rule', () => {
  const two = Object.assign(plain(TYPE2), { record: [{ name: 'env', label: 'Env', kind: 'choice', options: ['dev', 'DEV'] }] });
  same(T.checkCustom(two), ['record 1: dev and DEV differ only in capitals; keep one']);
  const one = plain(two); delete one.format; delete one.features; delete one.app;
  same(T.checkCustom(one), []);
});

rule('A step type from a newer major or with a feature this copy doesn\'t know is named, never read', () => {
  assert.ok(/needs Flightdeck 2\.1/.test(T.checkCustom(Object.assign(plain(TYPE2), { features: ['typed-evidence', 'from-the-future'], app: '2.1.0' }))[0]));
  assert.ok(/newer Flightdeck|Needs/i.test(T.checkCustom(Object.assign(plain(TYPE2), { format: 'flightdeck-step-type/3', app: '3.0.0' }))[0]));
});

rule('A typed team type is frozen as version 3, without its file\'s envelope; a plain one stays version 2', () => {
  const c = T.customType(TYPE2), f = T.freeze(['team.count'], { 'team.count': c })['team.count'];
  same(f, { id: 'team.count', label: 'Count rows', icon: 'doc', hint: 'Counts the rows in a restored copy.', fields: { system: { label: 'System', kind: 'text', required: false } }, version: 3, custom: true,
    record: [{ name: 'rows', label: 'Rows', kind: 'number', min: '0' }, { name: 'matches', label: 'Matches the source', kind: 'yes-no' }] });
  assert.ok(T.understood(f));
  const p = plain(TYPE2); delete p.format; delete p.features; delete p.app; p.record = [{ name: 'n', label: 'N', kind: 'text' }];
  assert.strictEqual(T.customType(p).version, 2);
});

rule('A frozen definition may use the 2.0 kinds and keys only at version 3, with values this copy can check', () => {
  const base = { id: 'team.count', label: 'Count', fields: {}, version: 3, record: [{ name: 'rows', label: 'Rows', kind: 'number', min: '0', max: '9', unit: 'rows' }] };
  assert.ok(T.understood(base));
  assert.ok(!T.understood(Object.assign(plain(base), { version: 2 })), '2.0 kinds at version 2');
  assert.ok(!T.understood(Object.assign(plain(base), { version: 4 })));
  assert.ok(T.understood(Object.assign(plain(base), { record: [{ name: 'x', label: 'X', kind: 'text' }] })), 'version 3 with nothing new is still read');
  [{ min: 0 }, { min: '1e3' }, { min: 'NaN' }, { max: '-0' }, { min: '5', max: '1' }, { unit: 7 }, { unit: '' }].forEach(bad => {
    const d = plain(base); Object.assign(d.record[0], bad);
    assert.ok(!T.understood(d), JSON.stringify(bad));
  });
  const yn = plain(base); yn.record = [{ name: 'ok', label: 'OK', kind: 'yes-no', min: '1' }];
  assert.ok(!T.understood(yn), 'min on a yes/no');
  [NaN, Infinity, 1e999, -0, 2 ** 53 + 1, null, '3', true].forEach(v => assert.ok(!T.understood(Object.assign(plain(base), { version: v })) || v === -0 || v === null, String(v)));
});

rule('Typed evidence is checked when a step is done: an invalid number names its box; the value is stored canonical', () => {
  const t = T.customType(TYPE2);
  same(T.checkRecord(t, {}, { rows: ' 1234.50 ', matches: 'Yes' }), { values: { rows: '1234.5', matches: 'yes' } });
  same(T.checkRecord(t, {}, { rows: '12a' }), { error: 'Type a number, like 12 or 3.5.', field: 'rows' });
  same(T.checkRecord(t, {}, { rows: '-1' }), { error: 'Rows can\'t be less than 0.', field: 'rows' });
  const plainStep = T.get('confirm');
  same(T.checkRecord(plainStep, { evidence: 'date' }, { evidence: '2026-02-30' }), { error: 'Pick a date.', field: 'evidence' });
  same(T.checkRecord(plainStep, { evidence: 'date' }, { evidence: '2026-02-28' }), { values: { evidence: '2026-02-28' } });
  same(T.checkRecord(plainStep, { evidence: 'number' }, {}), { error: 'The number you saw is needed to check this step.', field: 'evidence' });
});

/* ---------- Publishing: the lowest sufficient format ---------- */
const NOW = '2026-10-21T09:00:00.000Z';
const R = PF.run;
const TYPED_MD = ['---', 'process: count', 'title: Count check', 'context: ticket, rows:number, due:date, approved:yes-no, env:choice(dev|test|prod), runbook:link', 'roles: lead', '---', '',
  '## Prepare · READ-DO {#prep}', '- [!] {confirm} Read the runbook ^runbook @lead {#read}', '- [ ] {team.count} Count the rows ^rows @lead {#count}', '- [ ] {confirm} Note the restore day {#day}', '  evidence: date', '',
  '## Gate: Counted {#counted}', '  approves: ^rows ^approved', '',
  '## Close · DO-CONFIRM {#close}', '- [ ] {confirm} File the report ^due @lead {#file}', '- [ ] {confirm} Record the total {#total}', '  sets: rows', ''].join('\n');
const CUSTOM = { 'team.count': T.customType(TYPE2) };
function publish(md, customTypes) {
  const b = P.build(md, { people: [], customTypes: customTypes || CUSTOM, by: 'person-avery', changes: 'First', existing: [], now: NOW, rand: 'abcd1234', app: '2.0.0' });
  assert.ok(!b.blockers, (b.blockers || []).join(' | '));
  const v = P.verify(b.folder, b.files, exactOf(PF, b.files));
  assert.ok(v.ok, v.why);
  return { b, v };
}
const UNTYPED_MD = TYPED_MD.replace('ticket, rows:number, due:date, approved:yes-no, env:choice(dev|test|prod), runbook:link', 'ticket, rows, due, approved, env, runbook').replace('{team.count}', '{confirm}').replace('  evidence: date\n', '');

rule('A checklist with typed details or typed evidence publishes as /2 naming them; one without stays /1 with no envelope', () => {
  const { b } = publish(TYPED_MD), info = JSON.parse(b.files['publication.json']);
  assert.strictEqual(info.format, 'preflight-publication/2');
  same(info.features, ['typed-details', 'typed-evidence']);
  assert.strictEqual(JSON.parse(b.files['types.json'])['team.count'].version, 3);
  const plainPub = JSON.parse(publish(UNTYPED_MD).b.files['publication.json']);
  assert.strictEqual(plainPub.format, 'preflight-publication/1');
  assert.ok(!('features' in plainPub) && !('payload' in plainPub));
});

rule('A version that uses only a typed step type is typed-evidence, from its frozen definition', () => {
  const md = UNTYPED_MD.replace('{confirm} Count the rows', '{team.count} Count the rows');
  same(JSON.parse(publish(md).b.files['publication.json']).features, ['typed-evidence']);
  same(P.features(M.parse(md), JSON.parse(publish(md).b.files['types.json'])), ['typed-evidence']);
});

rule('The publish panel names the typed details by name and says what typed evidence is', () => {
  const n = P.needs(M.parse(TYPED_MD), JSON.parse(publish(TYPED_MD).b.files['types.json']));
  same(n.features, ['typed-details', 'typed-evidence']);
  same(n.names, ['typed run details (rows, due, approved, env, runbook)', 'typed evidence (a number, yes/no or date)']);
});

rule('A version whose record doesn\'t list a typed feature it uses, or a /1 version that uses one, is unusable: edited by hand', () => {
  const { b } = publish(TYPED_MD), info = JSON.parse(b.files['publication.json']);
  const without = Object.assign({}, info, { features: ['typed-evidence'] });
  const v = P.verify(b.folder, Object.assign({}, b.files, { 'publication.json': JSON.stringify(without) }), exactOf(PF, b.files));
  assert.ok(!v.ok && v.unusable && /typed-details/.test(v.why), v.why);
  const one = publish(UNTYPED_MD).b, i1 = JSON.parse(one.files['publication.json']);
  const md = TYPED_MD, typesJson = publish(TYPED_MD).b.files['types.json'];
  const forged = { 'map.md': md, 'types.json': typesJson, 'publication.json': JSON.stringify(Object.assign({}, i1, { mapHash: PF.util.hash(md), typesHash: PF.util.hash(typesJson) })) };
  const v1 = P.verify(one.folder, forged);
  assert.ok(!v1.ok && v1.unusable, v1.why);
});


/* ---------- Runs: typed values in, migrations, the consumption guard ---------- */
const PUBT = () => publish(TYPED_MD).v;
const startT = (o) => R.create(PUBT(), Object.assign({ title: 'Count October', details: {}, roles: { lead: 'person-avery' }, by: 'person-avery', session: 'w-a', now: NOW, id: 'run-t1', app: '2.0.0' }, o || {}));
const mapT = () => M.parse(TYPED_MD);
const errOf = (fn) => { try { fn(); } catch (e) { return { message: e.message, field: e.field }; } return null; };

rule('A typed run starts as run/3 with each typed detail stored canonical; a value that isn\'t right names its box', () => {
  const r = startT({ details: { ticket: 'ABC-1', rows: ' 1234.50 ', due: '2026-10-31', approved: 'Yes', env: 'PROD', runbook: 'https://example.com/rb' } });
  assert.strictEqual(r.format, 'preflight-run/3');
  same(r.features, ['typed-details', 'typed-evidence']);
  same(r.details, { ticket: 'ABC-1', rows: '1234.5', due: '2026-10-31', approved: 'yes', env: 'prod', runbook: 'https://example.com/rb' });
  assert.ok(!('migrations' in r), 'nothing to migrate, no list');
  same(errOf(() => startT({ details: { rows: '12a' } })), { message: 'Type a number, like 12 or 3.5.', field: 'rows' });
  same(errOf(() => startT({ details: { due: '2026-02-30' } })), { message: 'Pick a date.', field: 'due' });
});

rule('Changing a typed run detail checks it and stores it canonical; a refused value changes nothing', () => {
  const r = startT({ details: { rows: '10' } }), map = mapT();
  R.setDetail(r, map, 'rows', '+12.0', 'person-avery', NOW);
  assert.strictEqual(r.details.rows, '12');
  const before = JSON.stringify(r);
  same(errOf(() => R.setDetail(r, map, 'rows', 'twelve', 'person-avery', NOW)), { message: 'Type a number, like 12 or 3.5.', field: 'rows' });
  assert.strictEqual(JSON.stringify(r), before);
});

rule('A run started from text (a plan) migrates each typed detail: exact stays, converted is recorded, the rest wait for a person', () => {
  const from = { source: 'plan', details: { ticket: 'ABC-2', rows: '1234.50', due: '03/04/2026', approved: 'yes', env: 'staging' } };
  const r = startT({ details: from.details, from });
  same(r.details, { ticket: 'ABC-2', rows: '1234.5', due: '', approved: 'yes', env: '', runbook: '' });
  same(r.migrations, [
    { path: 'details.rows', at: NOW, from: '1234.50', source: 'plan', verdict: 'converted', result: '1234.5', resolved: null },
    { path: 'details.due', at: NOW, from: '03/04/2026', source: 'plan', verdict: 'ambiguous', result: null, resolved: null },
    { path: 'details.env', at: NOW, from: 'staging', source: 'plan', verdict: 'invalid', result: null, resolved: null }]);
  same(Object.keys(r).slice(Object.keys(r).indexOf('migrations'), Object.keys(r).indexOf('migrations') + 2), ['migrations', 'steps'], 'migrations sit right before steps, as in the frozen sample');
  same(R.openMigrations(r).map(m => m.path), ['details.due', 'details.env']);
});

rule('A person\'s own entry on the start form resolves a value that didn\'t convert, once', () => {
  const from = { source: 'plan', details: { due: '03/04/2026' } };
  const r = startT({ details: { due: '2026-03-04' }, from });
  assert.strictEqual(r.details.due, '2026-03-04');
  same(r.migrations, [{ path: 'details.due', at: NOW, from: '03/04/2026', source: 'plan', verdict: 'ambiguous', result: null, resolved: { by: 'person-avery', at: NOW, value: '2026-03-04' } }]);
  assert.strictEqual(R.openMigrations(r).length, 0);
});

rule('Filling in a waiting value resolves it once; later changes change the value only', () => {
  const r = startT({ details: { due: '03/04/2026' }, from: { source: 'plan', details: { due: '03/04/2026' } } }), map = mapT();
  R.setDetail(r, map, 'due', '2026-04-03', 'person-blake', '2026-10-22T09:00:00.000Z');
  same(r.migrations[0].resolved, { by: 'person-blake', at: '2026-10-22T09:00:00.000Z', value: '2026-04-03' });
  R.setDetail(r, map, 'due', '2026-04-05', 'person-avery', '2026-10-23T09:00:00.000Z');
  same(r.migrations[0].resolved, { by: 'person-blake', at: '2026-10-22T09:00:00.000Z', value: '2026-04-03' });
  assert.strictEqual(r.details.due, '2026-04-05');
});

rule('A value still waiting can\'t be used: no step bound to it is checked, no gate approving it passes', () => {
  const r = startT({ details: { rows: '1,234', due: '03/04/2026' }, from: { source: 'plan', details: { rows: '1,234', due: '03/04/2026' } } }), map = mapT();
  ['read', 'count', 'day'].forEach(id => { try { R.done(r, map, id, 'person-avery', NOW, id === 'count' ? { rows: '5', matches: 'yes' } : id === 'day' ? { evidence: '2026-10-01' } : {}); } catch (e) { if (id === 'count') assert.strictEqual(e.message, 'Rows still needs a number (it was "1,234" in the plan).'); else throw e; } });
  assert.notStrictEqual(r.steps.count && r.steps.count.s, 'done');
  R.setDetail(r, map, 'rows', '1234', 'person-avery', NOW);
  R.done(r, map, 'count', 'person-avery', NOW, { rows: '5', matches: 'yes' });
  R.setDetail(r, map, 'approved', 'yes', 'person-avery', NOW);
  R.pass(r, map, 0, 'person-avery', NOW);
  assert.strictEqual(r.gates.counted.s, 'passed');
  assert.throws(() => R.done(r, map, 'file', 'person-avery', NOW), /^Error: Due still needs a date \(it was "03\/04\/2026" in the plan\)\.$/);
  assert.strictEqual(R.consumption(r, ['due']), 'Due still needs a date (it was "03/04/2026" in the plan).');
  assert.strictEqual(R.consumption(r, ['rows']), '');
});

rule('Run/3 reading checks typed values against the run\'s own checklist: an invalid one stays as written and is named, never coerced', () => {
  const r = startT({ details: { rows: '12' } });
  const file = JSON.parse(JSON.stringify(r));
  file.details.rows = '12a'; file.details.approved = 'Yes';
  file.steps.count = { s: 'done', by: 'person-avery', at: NOW, values: { rows: '1e3', matches: 'yes' } };
  const back = R.sanitize(file);
  assert.ok(!back._unrunnable, back._unrunnable);
  assert.strictEqual(back.details.rows, '12a');
  same(Object.keys(back._invalid).sort(), ['details.approved', 'details.rows', 'steps.count.values.rows']);
  same(back._invalid['details.rows'], { raw: '12a', why: 'Not a number: "12a". Fill in to correct it.' });
  same(R.repairs(file).filter(x => /malformed/.test(x.what)).map(x => x.at).sort(), ['details.approved', 'details.rows', 'steps.count.values.rows']);
  assert.ok(!('_invalid' in JSON.parse(JSON.stringify(Object.assign({}, back, { _invalid: undefined })))));
});

rule('Migration records are kept exactly; any entry not in the frozen shape makes the run name-only', () => {
  const r = startT({ details: { due: '03/04/2026' }, from: { source: 'plan', details: { due: '03/04/2026' } } });
  const file = JSON.parse(JSON.stringify(r));
  same(R.sanitize(file).migrations, file.migrations);
  const bad = [
    (f) => { f.migrations[0].extra = 1; },
    (f) => { f.migrations[0].verdict = 'guessed'; },
    (f) => { f.migrations[0].source = 'email'; },
    (f) => { f.migrations[0].path = 'details.nope'; },
    (f) => { f.migrations[0].path = 'details.__proto__'; },
    (f) => { f.migrations[0].from = 'x'.repeat(301); },
    (f) => { f.migrations[0].resolved = { by: 'a', at: NOW }; },
    (f) => { f.migrations[0].at = 1e999; },
    (f) => { f.migrations[0] = null; },
    (f) => { f.migrations = { 0: 1 }; },
    (f) => { f.migrations[0].result = 12; }
  ];
  bad.forEach((b, i) => { const f = JSON.parse(JSON.stringify(file)); b(f); const s = R.sanitize(f); assert.ok(s && s._unrunnable && /name only/.test(s._unrunnable) && !Object.keys(s.steps).length, 'case ' + i); });
});

rule('Past 200 migration records the oldest closed ones move to the run\'s history file; open ones never move', () => {
  const r = startT({ details: { due: '03/04/2026' }, from: { source: 'plan', details: { due: '03/04/2026' } } });
  r.migrations.push({ path: 'details.rows', at: NOW, from: '01', source: 'carry', verdict: 'converted', result: '1', resolved: null });
  for (let i = 0; i < 205; i++) r.migrations.push({ path: 'details.rows', at: NOW, from: 'x' + i, source: 'report', verdict: 'converted', result: '1', resolved: null });
  R.trimMigrations(r);
  assert.strictEqual(r.migrations.length, 200);
  assert.strictEqual(r.migrations[0].path, 'details.due', 'the open one stays');
  assert.strictEqual(r.migrations[1].source, 'carry', 'a carry record stays: a parent settles this run by it');
  same(r._overflow.slice(0, 1), [{ kind: 'migration', av: 1, path: 'details.rows', at: NOW, from: 'x0', source: 'report', verdict: 'converted', result: '1', resolved: null }]);
  assert.strictEqual(r._overflow.filter(x => x.kind === 'migration').length, 7);
});

rule('Comparing two copies of a typed run names migration differences', () => {
  const r = startT({ details: { due: '03/04/2026' }, from: { source: 'plan', details: { due: '03/04/2026' } } }), b = JSON.parse(JSON.stringify(r));
  R.setDetail(b, mapT(), 'due', '2026-03-04', 'person-avery', NOW);
  assert.ok(R.compare(r, b, mapT(), x => x).some(l => /^Migration details\.due/.test(l)), JSON.stringify(R.compare(r, b, mapT(), x => x)));
});

rule('A run of a plain checklist is the same run/2 as before: no detail checks, no migrations', () => {
  const pub = publish(UNTYPED_MD).v;
  const r = R.create(pub, { details: { rows: '1,234' }, from: { source: 'plan', details: { rows: '1,234' } }, roles: {}, by: 'a', session: 's', now: NOW, id: 'run-p' });
  assert.strictEqual(r.format, 'preflight-run/2');
  assert.strictEqual(r.details.rows, '1,234');
  assert.ok(!('migrations' in r) && !('_invalid' in R.sanitize(JSON.parse(JSON.stringify(r)))));
});



rule('A child that migrated what its parent carried stands for the parent\'s step; one still waiting keeps it open', () => {
  const step = { id: 'verify', type: 'run.process', fields: { process: 'verify', carry: 'amount' }, binds: [] };
  const parent = { format: 'preflight-run/2', steps: { verify: { s: 'open', child: { process: 'verify', id: 'k1', inputs: { amount: '01' } } } }, fields: {}, details: { amount: '01' } };
  const child = (details, migrations) => ({ process: 'verify', id: 'k1', format: 'preflight-run/2', details, migrations, ended: { outcome: 'Completed' } });
  const a = parent.steps.verify;
  same(R.childVerdict(parent, step, a, child({ amount: '1' }, [{ path: 'details.amount', at: NOW, from: '01', source: 'carry', verdict: 'converted', result: '1', resolved: null }])), { s: 'done' });
  assert.strictEqual(R.childVerdict(parent, step, a, child({ amount: '' }, [{ path: 'details.amount', at: NOW, from: '01', source: 'carry', verdict: 'ambiguous', result: null, resolved: null }])), null);
  same(R.childVerdict(parent, step, a, child({ amount: '2' }, [{ path: 'details.amount', at: NOW, from: '01', source: 'carry', verdict: 'converted', result: '1', resolved: null }])).s, 'blocked', 'changed after it converted');
  same(R.childVerdict(parent, step, a, child({ amount: '1' }, [])).s, 'blocked', 'no record: a different value');
});


rule('A run/3 holding null where text belongs is read-only, never saved as empty; -0 is never a number bound', () => {
  const r = startT({ details: { rows: '12' } }), f = JSON.parse(JSON.stringify(r));
  f.details.rows = null;
  const back = R.sanitize(f);
  assert.ok(back._unrunnable && /rows/.test(back._unrunnable), back._unrunnable);
  assert.ok(!V.isNumber('-0') && V.numberDefProblems({ kind: 'number', max: '-0' }, 'x').length === 1);
  assert.ok(T.checkRecord(T.customType(Object.assign({}, TYPE2, { record: [{ name: 'rows', label: 'Rows', kind: 'number', max: '0' }] })), {}, { rows: '0' }).values);
});

/* ---------- READ/2: typed values for other apps ---------- */
const AJ = PF.appjson, FIX = require('path').join(__dirname, 'fixtures', 'v2', 'folder');
const wrongs = (v, d) => JSON.parse(JSON.stringify(AJ.conforms(v, d)));
const nameOfT = AJ.names([{ id: 'person-avery', name: 'Avery' }]);

rule('READ/2 reads a typed run: details and values carry their kind, the stored text, a typed value and the migration', () => {
  const file = JSON.parse(require('fs').readFileSync(require('path').join(FIX, 'runs/backup/run-c/run.json'), 'utf8'));
  const r = R.sanitize(file);
  assert.ok(r && !r._unrunnable, r && r._unrunnable);
  r._archivedMigrations = [];
  const out = AJ.run2(r, [], nameOfT);
  same(wrongs(out, AJ.SCHEMA2.run), []);
  same(out.run.details.rows, { type: 'number', text: '1234.5', value: '1234.5', valid: true, migration: null });
  same(out.run.details.approved, { type: 'yes-no', text: 'yes', value: true, valid: true, migration: null });
  same(out.run.details.ticket, { type: 'text', text: 'ABC-201', value: 'ABC-201', valid: true, migration: null });
  same(out.run.details.due.migration, { path: 'details.due', at: file.migrations[0].at, from: '10/31/2026', source: 'plan', verdict: 'ambiguous', result: null, resolved: { by: { id: 'person-avery', name: 'Avery' }, at: file.migrations[0].at, value: '2026-10-31' }, open: false });
  same(out.run.steps.find(s => s.id === 'count').values.matches.value, true);
  same(out.run.steps.find(s => s.id === 'count').evidence.map(e => e.type), ['number', 'yes-no']);
  same(out.run.format, 'preflight-run/3');
  assert.strictEqual(out.run.migrations.length, 1);
});

rule('READ/2 names an invalid stored value as not valid with a null value; a waiting one is null too', () => {
  const r = startT({ details: { due: '03/04/2026' }, from: { source: 'plan', details: { due: '03/04/2026' } } });
  const f = JSON.parse(JSON.stringify(r)); f.details.rows = '12a';
  const back = R.sanitize(f), out = AJ.run2(back, [], nameOfT);
  same(wrongs(out, AJ.SCHEMA2.run), []);
  same(out.run.details.rows, { type: 'number', text: '12a', value: null, valid: false, migration: null });
  assert.strictEqual(out.run.details.due.value, null);
  assert.strictEqual(out.run.details.due.migration.open, true);
});

rule('READ/2 describes a typed process: each detail\'s type and options, each evidence entry\'s type, min, max and unit', () => {
  const pub = PUBT(), proc = { process: 'count', pubs: [pub], index: P.index([pub]) };
  const out = AJ.process2(proc, pub);
  same(wrongs(out, AJ.SCHEMA2.process), []);
  same(out.details.map(d => d.name + ':' + d.type), ['ticket:text', 'rows:number', 'due:date', 'approved:yes-no', 'env:choice', 'runbook:link']);
  same(out.details[4].options, ['dev', 'test', 'prod']);
  const count = out.phases[0].steps.find(s => s.id === 'count');
  same(count.evidence.map(e => [e.type, e.min]), [['number', '0'], ['yes-no', null]]);
  same(out.features, ['typed-details', 'typed-evidence']);
});

rule('The builder\'s Run details list adds and removes a name without dropping any other detail\'s kind', () => {
  const O = PF.outline;
  const md = '---\ntitle: T\ncontext: ticket, rows:number, env:choice(dev|prod), due:date\n---\n\n## Phase\n\n- [ ] Step ^ticket\n';
  const add = O.apply(md, { op: 'meta', key: 'context', set: { add: 'commit' } });
  assert.ok(!add.error, add.error);
  assert.ok(add.text.indexOf('context: ticket, rows:number, env:choice(dev|prod), due:date, commit\n') >= 0, add.text);
  const del = O.apply(add.text, { op: 'meta', key: 'context', set: { remove: 'rows' } });
  assert.ok(!del.error, del.error);
  assert.ok(del.text.indexOf('context: ticket, env:choice(dev|prod), due:date, commit\n') >= 0, del.text);
  same(PF.map.parse(del.text).meta.detailTypes, { env: { kind: 'choice', options: ['dev', 'prod'] }, due: { kind: 'date' } });
  const dup = O.apply(md, { op: 'meta', key: 'context', set: { add: 'rows' } });
  assert.ok(dup.error && /already/.test(dup.error), 'a typed name is already listed');
});

run();
