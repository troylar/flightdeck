/* people.json: the team's people, and who keeps the list. The folder owner and the backup owner ("folderRole") change it in
   Settings; nobody else's Flightdeck ever writes it. IDs are made once from a name and never change. Pure; see docs/design.md
   section 2. Roles prevent ordinary mistakes; they aren't security (anyone who can open the folder can edit any file). */
PF.people = (function () {
  'use strict';
  var U = PF.util;
  var FILE = 'people.json', ROLES = ['owner', 'backup'];

  function initials(name) { return String(name || '').trim().split(/\s+/).map(function (w) { return w[0] || ''; }).join('').slice(0, 3).toUpperCase(); }
  /* The list inside the file: people.json is an array; an older { "people": [...] } is read too. */
  function listOf(doc) { return Array.isArray(doc) ? doc : doc && Array.isArray(doc.people) ? doc.people : []; }
  /* What the app shows and checks, from what the file says. Entries without an id and a name are skipped. */
  /* The envelope's verdict on people.json: an array or { people } is format 1; a newer major or an unknown feature is refused,
     so nothing reads it as a list of people and Settings never rewrites it. */
  function verdict(doc) {
    if (doc == null) return { ok: true };
    var v = PF.envelope.judge('flightdeck-people', doc);
    return v.ok || v.kind !== 'newer' ? { ok: true } : { ok: false, kind: 'newer', why: 'people.json was made with a newer Flightdeck. ' + PF.envelope.needsText(v.needs) + ' This copy can\'t read or change it.', needs: v.needs || '' };
  }
  function clean(doc) {
    if (!verdict(doc).ok) return [];
    return listOf(doc).filter(function (p) { return p && typeof p.id === 'string' && typeof p.name === 'string'; }).map(function (p) {
      return { id: p.id, name: p.name.slice(0, 60), initials: String(p.initials || initials(p.name)).slice(0, 3).toUpperCase(), email: String(p.email || ''), inactive: !!p.inactive, folderRole: ROLES.indexOf(p.folderRole) >= 0 ? p.folderRole : '' };
    });
  }
  /* "person-" and the name in lowercase letters, numbers and dashes; "-2", "-3"… when it's taken (inactive people included). */
  function idFor(name, taken) {
    var plain = String(name || ''); if (plain.normalize) plain = plain.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    var base = 'person-' + (/[a-z0-9]/i.test(plain) ? U.slug(plain, 30) : 'someone'), has = function (x) { return taken.some(function (t) { return String(t).toLowerCase() === x; }); };
    if (!has(base)) return base;
    for (var n = 2; ; n++) if (!has(base + '-' + n)) return base + '-' + n;
  }
  function roles(people) {
    var owners = people.filter(function (p) { return p.folderRole === 'owner'; }), backups = people.filter(function (p) { return p.folderRole === 'backup'; });
    return { owner: owners[0] || null, backup: backups[0] || null, owners: owners, backups: backups };
  }
  /* Only the folder owner and the backup owner, while active, change the list in Flightdeck. */
  function canManage(people, me) {
    if (!me) return false;
    var p = people.filter(function (x) { return x.id === me; })[0];
    return !!p && !p.inactive && (p.folderRole === 'owner' || p.folderRole === 'backup');
  }
  function checkName(name) {
    var n = String(name || '').replace(/[\u0000-\u001f]/g, '').trim();
    if (!n) throw new Error('Type a name.');
    if (n.length > 60) throw new Error('Keep the name under 60 characters.');
    return n;
  }
  function checkEmail(email) {
    var e = String(email || '').trim();
    if (e && !/^[^\s@]+@[^\s@]+$/.test(e)) throw new Error('That email address doesn\'t look right. Leave it blank if you don\'t know it.');
    return e.slice(0, 120);
  }
  function entry(name, email, id) { var p = { id: id, name: name, initials: initials(name) }; p.email = email; return p; }

  /* A new team's people.json: you as folder owner, your teammates, and the backup owner you chose (an index in team). */
  function create(me, team, backup) {
    var taken = [], doc = [];
    var add = function (x, role) { var name = checkName(x.name), p = entry(name, checkEmail(x.email), idFor(name, taken)); if (role) p.folderRole = role; taken.push(p.id); doc.push(p); return p; };
    add(me, 'owner');
    team.forEach(function (x, i) { add(x, i === backup ? 'backup' : ''); });
    doc.forEach(function (p) { if (!p.folderRole) delete p.folderRole; });
    return doc;
  }

  /* Changes the folder owner or backup makes in Settings. Each returns a new document; fields Flightdeck doesn't know stay. */
  function copy(doc) { return JSON.parse(JSON.stringify(doc == null ? [] : doc)); }
  function find(list, id) { for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i]; throw new Error('That person isn\'t in people.json any more.'); }
  function add(doc, name, email) {
    var out = copy(doc), list = listOf(out), n = checkName(name), p = entry(n, checkEmail(email), idFor(n, list.map(function (x) { return x && x.id; }).filter(Boolean)));
    list.push(p);
    return { doc: out, person: p };
  }
  function setActive(doc, id, active, me) {
    var out = copy(doc), p = find(listOf(out), id);
    if (!active && id === me) throw new Error('You can\'t mark yourself inactive. Make someone else folder owner or backup first.');
    if (active) delete p.inactive; else p.inactive = true;
    return { doc: out, person: p };
  }
  /* role "backup": the person takes it and whoever had it gives it up. role "owner": the person takes it and the old owner
     takes their place (backup, or nothing), unless the old owner is inactive. */
  function setRole(doc, id, role) {
    if (ROLES.indexOf(role) < 0) throw new Error('Unknown role.');
    var out = copy(doc), list = listOf(out), p = find(list, id), was = p.folderRole || '';
    if (p.inactive) throw new Error(p.name + ' is marked inactive. Mark them active first.');
    if (was === role) return { doc: out, person: p };
    if (role === 'backup' && was === 'owner') throw new Error(p.name + ' is the folder owner already.');
    list.forEach(function (x) {
      if (!x || x === p || x.folderRole !== role) return;
      if (role === 'owner' && was && !x.inactive) x.folderRole = was; else delete x.folderRole;
    });
    p.folderRole = role;
    return { doc: out, person: p };
  }
  /* Whether me may do act ("add", "inactive", "active", "backup", "owner") to person id: '' when allowed, else why not. The
     backup owner takes over the folder only once the owner is inactive or gone (succession). */
  function allowed(people, me, act, id) { return permits(people, me)(act, id); }
  /* allowed() for many people at once (Settings › People): one pass over the list, then each answer looks its person up. The
     first row for an ID is the one that counts, as everywhere. */
  function permits(people, me) {
    var byId = Object.create(null), owner = null;
    people.forEach(function (x) { PF.perf.add('people.rows'); if (!(x.id in byId)) byId[x.id] = x; if (!owner && x.folderRole === 'owner') owner = x; });
    var mine = me ? byId[me] : null, manage = !!mine && !mine.inactive && (mine.folderRole === 'owner' || mine.folderRole === 'backup'), ownerHere = owner && !owner.inactive;
    return function (act, id) {
      if (!manage) return 'Only the folder owner and backup owner change the people list.';
      if (act === 'add') return '';
      var p = id in byId ? byId[id] : null;
      if (!p) return 'That person isn\'t in people.json any more.';
      if (act === 'active') return p.inactive ? '' : p.name + ' is active already.';
      if (act === 'inactive') return p.inactive ? p.name + ' is inactive already.' : id === me ? 'You can\'t mark yourself inactive. Make someone else folder owner or backup first.' : '';
      if (p.inactive) return p.name + ' is marked inactive. Mark them active first.';
      if (act === 'backup') return p.folderRole === 'owner' ? p.name + ' is the folder owner.' : '';
      if (act === 'owner') {
        if (p.folderRole === 'owner') return p.name + ' is the folder owner already.';
        if (owner && owner.id === me) return '';
        return id === me && !ownerHere ? '' : 'Only the folder owner hands the folder to someone else, or the backup owner once the owner is inactive.';
      }
      return 'Unknown change.';
    };
  }
  /* How a person is named where someone is chosen: a name two people share gets their email, else their ID. */
  function label(p, all) {
    PF.perf.add('people.names', (all || []).length);
    var n = String(p.name || '').trim().toLowerCase(), twin = (all || []).some(function (x) { return x !== p && x.id !== p.id && String(x.name || '').trim().toLowerCase() === n; });
    return twin ? p.name + ' (' + (p.email || p.id) + ')' : p.name;
  }
  /* label() for everyone a picker lists, built once from that list: twins are a name two different IDs share. */
  function labeler(all) {
    var ids = Object.create(null);
    (all || []).forEach(function (x) { PF.perf.add('people.names'); var n = String(x.name || '').trim().toLowerCase(); (ids[n] = ids[n] || Object.create(null))[x.id] = true; });
    return function (p) {
      var set = ids[String(p.name || '').trim().toLowerCase()], twin = false;
      if (set) for (var k in set) if (k !== String(p.id)) { twin = true; break; }
      return twin ? p.name + ' (' + (p.email || p.id) + ')' : p.name;
    };
  }
  function text(doc) { return JSON.stringify(doc, null, 2) + '\n'; }

  /* What someone not on the list sends the folder owner. */
  function request(o) {
    return ['Hi ' + (o.owner || 'there') + ',', '',
      'Could you add me to Flightdeck for the team folder "' + o.folder + '"?', '',
      'Name: ' + (String(o.name || '').trim() || '(your name)'), 'Email: ' + (String(o.email || '').trim() || '(optional)'), '',
      'In Flightdeck: Settings, People, Add a person. Then I can choose my name when I open the folder.', '', 'Thanks!'].join('\n');
  }

  return { FILE: FILE, ROLES: ROLES, initials: initials, checkName: checkName, checkEmail: checkEmail, allowed: allowed, permits: permits, label: label, labeler: labeler, listOf: listOf, clean: clean, verdict: verdict, idFor: idFor, roles: roles, canManage: canManage, create: create, add: add, setActive: setActive, setRole: setRole, text: text, request: request };
})();
