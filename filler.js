// Consent filler — fills KSUMC eConsent AD-CON-01 (surgical) and AD-CON-03 (blood).
// Spec: Obsidian Vault/Systems/machine/consent-filler.md
// Two ways to run it:
// - the iPhone Shortcut "Fill consent" (Share sheet), which prepends
//   var CF_STAFF="<base64 of staff.md>"; var CF_CLIP="<base64 of clipboard>";
//   and gets the answer through completion(). Each such run saves the staff list and this
//   script in the site's localStorage, for:
// - the "Fill" Safari bookmark (bookmark.txt), which evals the saved script: no clipboard, no
//   vault, answer shown as a message on the page. Follow-on work only (blood tab, signer copy,
//   nurse swap) — it refuses a blank surgical form, so a stale block can't fill a new patient.
// Never submits, never signs, and never reloads a page that has ink in a signature box.
// Answers with a message starting ✅, 👉 (tap something, then Fill again), 🔄 (reloading: Fill again), ⚠️,
// or, for the shared Shortcut only, 🔢 (it asks the MRN) and ❓ (it asks this question, answer in CF_ANSWER).
(function cfMain() {
  var viaShortcut = typeof completion === 'function';
  // Bookmark runs show the answer on the page; it disappears by itself or when tapped.
  function toast(r) {
    try {
      var old = document.getElementById('cfToast'); if (old) old.remove();
      var t = document.createElement('div');
      t.id = 'cfToast';
      t.textContent = r;
      t.style.cssText = 'position:fixed;left:12px;right:12px;top:12px;z-index:2147483647;padding:14px 16px;border-radius:14px;' +
        'background:' + (/^⚠️/.test(r) ? '#fff1f0' : '#f0f9f0') + ';color:#111;border:2px solid ' + (/^⚠️/.test(r) ? '#d4380d' : '#389e0d') +
        ';box-shadow:0 6px 24px rgba(0,0,0,.25);font:16px/1.35 -apple-system,sans-serif;white-space:pre-line';
      t.onclick = function () { t.remove(); };
      document.body.appendChild(t);
      setTimeout(function () { if (t.parentNode) t.remove(); }, /^(⚠️|👉)/.test(r) ? 9000 : 5000);
    } catch (e) { alert(r); }
  }
  var done = function (r) { if (viaShortcut) completion(r); else toast(r); return r; };
  try {
    var dec = function (b) {
      try { return new TextDecoder().decode(Uint8Array.from(atob(String(b).replace(/\s/g, '')), function (c) { return c.charCodeAt(0); })); }
      catch (e) { return ''; }
    };
    var ls = function (k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; };
    var staffTxt = viaShortcut ? (typeof CF_STAFF !== 'undefined' ? dec(CF_STAFF) : (window.CF_STAFF_TXT || '')) : (ls('consentFillerStaff') || window.CF_STAFF_TXT || '');
    var clipTxt = viaShortcut ? (typeof CF_CLIP !== 'undefined' ? dec(CF_CLIP) : (window.CF_CLIP_TXT || '')) : '';
    // MRN typed in the Shortcut's popup (colleagues keep it out of their AI chat).
    var askedMrn = viaShortcut && typeof CF_MRN !== 'undefined' ? String(CF_MRN).replace(/[.,]0+$/, '').replace(/\D/g, '') : '';
    // Answer typed in the shared Shortcut's question popup (it asks when an answer starts with ❓).
    var canAsk = viaShortcut && typeof CF_ANSWER !== 'undefined';
    var answer = canAsk ? dec(CF_ANSWER).trim() : '';
    // Google Apps Script web app on the staff Sheet that adds a new nurse (sheet-add-nurse.gs).
    var ADD_URL = 'https://script.google.com/macros/s/AKfycbwtFI7RBqQ2mvVmTQsT_ZEhngIK4mtfvlO8IkFO2Mhjee6DBYNW0vWRMmiO-MBr3-MAkQ/exec';
    if (viaShortcut && staffTxt) { ls('consentFillerStaff', staffTxt); ls('consentFillerCode', '(' + cfMain.toString() + ')();'); }
    var $ = function (id) { return document.getElementById(id); };
    var val = function (id) { var e = $(id); return e ? String(e.value || '').trim() : ''; };
    var low = function (s) { return String(s || '').trim().toLowerCase(); };
    var digits = function (s) { return String(s || '').replace(/\D/g, ''); };
    var cap = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };
    var titled = function (s) { return String(s).trim().toLowerCase().replace(/(^|[\s'-])(\S)/g, function (m, a, ch) { return a + ch.toUpperCase(); }); };

    // ---------- staff list: "role: key | id | full name" lines (staff.md), rows of the shared
    // Google Sheet as CSV (Role, Short name, Full name, ID, Notes), and the Shortcut's own
    // "my registrar: / my resident: / my hospital:" defaults.
    var staff = { dr: [], consultant: [], resident: [], nurse: [] }, me = {};
    var csvRow = function (line) {
      var out = [], cur = '', q = false;
      for (var i = 0; i < line.length; i++) {
        var ch = line.charAt(i);
        if (q) { if (ch === '"') { if (line.charAt(i + 1) === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
        else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
      }
      out.push(cur);
      return out.map(function (x) { return x.trim(); });
    };
    staffTxt.split(/\r?\n/).forEach(function (line) {
      var my = line.match(/^\s*my\s+(registrar|resident|hospital)\s*:\s*(.*?)\s*$/i);
      if (my) { if (my[2]) me[low(my[1])] = my[2]; return; }
      var h = line.match(/^\s*hospital\s*:\s*(\S.*?)\s*$/i);
      if (h) { staff.hospital = h[1]; return; }
      var m = line.match(/^\s*[-*]?\s*(dr user|consultant|resident|nurse)\s*:\s*(.+)$/i);
      if (!m && line.indexOf(',') >= 0) {
        var r = csvRow(line), role = low(r[0]), key = low(r[1]), full = r[2] || r[1] || '', id = /^-?$/.test(r[3] || '') ? '' : r[3];
        if (role === 'hospital' && r[1]) staff.hospital = r[1];
        else if (!key) return;
        else if (role === 'registrar' && id) staff.dr.push({ key: key, id: id, name: full + (r[4] ? ' — ' + r[4] : '') });
        else if (role === 'consultant') staff.consultant.push({ key: key, name: full });
        else if (role === 'resident' || role === 'nurse') staff[role].push({ key: key, id: id || '', name: full });
        return;
      }
      if (!m) return;
      var p = m[2].split('|').map(function (x) { return x.trim(); });
      var role = low(m[1]) === 'dr user' ? 'dr' : low(m[1]);
      if (role === 'consultant') staff.consultant.push({ key: low(p[0]), name: p[1] || p[0] });
      // "dr user: key | ID | name" (key and name also match a subspecialty, e.g. "trauma"); old form "ID | name"
      else if (role === 'dr') staff.dr.push(p.length >= 3 ? { key: low(p[0]), id: p[1], name: p[2] } : { key: low(p[0]), id: p[0], name: p[1] || '' });
      // "key | full name" (no ID) or "key | ID | full name" (ID "-" = none)
      else if (p.length === 2) staff[role].push({ key: low(p[0]), id: '', name: p[1] });
      else staff[role].push({ key: low(p[0]), id: (p[1] && p[1] !== '-') ? p[1] : '', name: p[2] || p[0] });
    });
    var find = function (list, q) {
      q = low(q);
      if (!q) return null;
      return list.filter(function (x) { return x.key === q; })[0] ||
             list.filter(function (x) { return low(x.name) === q; })[0] ||
             list.filter(function (x) { return low(x.name).indexOf(q) >= 0; })[0] || null;
    };

    // ---------- CONSENT block from Claude (on the clipboard)
    // Copying from the Claude app can put formatted text on the clipboard: turn HTML or RTF into plain text.
    var clipKind = 'plain';
    if (/^\s*\{\\rtf/.test(clipTxt)) {
      clipKind = 'RTF';
      clipTxt = clipTxt
        .replace(/\\\r?\n/g, '\n')
        .replace(/\\u(-?\d+) ?\??/g, function (m, n) { n = +n; return String.fromCharCode(n < 0 ? n + 65536 : n); })
        .replace(/\\'([0-9a-f]{2})/gi, function (m, h) { return String.fromCharCode(parseInt(h, 16)); })
        .replace(/\\(par|line)\b ?/g, '\n')
        .replace(/\{\\\*[^{}]*\}|\{\\(fonttbl|colortbl|stylesheet|info)[\s\S]*?\}\}?/g, '')
        .replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '');
    } else if (/<(br|div|p|pre|span|code|meta|html)\b/i.test(clipTxt)) {
      clipKind = 'HTML';
      var tmp = document.createElement('div');
      tmp.innerHTML = clipTxt.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|pre|tr|h\d)>/gi, '\n');
      clipTxt = tmp.textContent || '';
    }
    // Any kind of line break (the iPhone clipboard may use \r, \u2028 or non-breaking spaces).
    clipTxt = clipTxt.replace(/\r\n?|[\u2028\u2029\u0085]/g, '\n').replace(/[\u00a0\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, function (ch) { return ch === '\u00a0' ? ' ' : ''; });
    var block = null;
    var at = clipTxt.search(/^\s*CONSENT\s*$/m);
    if (at >= 0) {
      block = {};
      clipTxt.slice(at).split('\n').forEach(function (line) {
        var m = line.match(/^\s*([a-z ]+?)\s*:\s*(.*)$/i);
        if (m) block[low(m[1])] = m[2].trim();
      });
    }

    // ---------- memory shared by the two tabs (same site → same localStorage)
    var KEY = 'consentFiller';
    var mem = null;
    try { mem = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    if (mem && Date.now() - mem.ts > 6 * 3600 * 1000) mem = null;
    var save = function (m) { m.ts = Date.now(); try { localStorage.setItem(KEY, JSON.stringify(m)); } catch (e) {} };

    // A block that differs in any way from the remembered one starts a new patient's memory.
    if (block && !(mem && mem.block && JSON.stringify(mem.block) === JSON.stringify(block))) {
      mem = { mrn: digits(block.mrn), block: block };
    }
    var c = (mem && mem.block) || block;
    var blockMrn = block ? digits(block.mrn) : '';
    // An MRN typed in the popup for someone else starts a new patient with the same block.
    if (askedMrn && c && !(mem && mem.mrn === askedMrn)) mem = { mrn: askedMrn, block: c };

    var diag = '\n(Clipboard: ' + clipKind + ', ' + clipTxt.length + ' characters, starts "' + clipTxt.slice(0, 12).replace(/\d/g, '#') + '", ' + (block ? 'block found with ' + Object.keys(block).join(', ') : 'no CONSENT line') +
      '; staff list: ' + staff.dr.length + ' Dr user, ' + staff.consultant.length + ' consultants, ' + staff.nurse.length + ' nurses.)';
    var form = /AD-CON-01/i.test(location.pathname) ? 'surgical' : /AD-CON-03/i.test(location.pathname) ? 'blood' : null;
    if (!form) return done('⚠️ Open the surgical (AD-CON-01) or blood (AD-CON-03) consent first.');

    // The bookmark never starts a patient: that needs Claude's block, read by Share → Fill consent.
    if (!viaShortcut && !(form === 'surgical' ? val('surNameEn') : val('bloodProduct'))) {
      if (form === 'surgical') return done('⚠️ Start each patient with Share → Fill consent on the surgical form (it reads the copied block). The Fill bookmark is for after that.');
      if (!(mem && mem.filled && mem.filled.surgical)) return done('⚠️ Fill the surgical consent first (Share → Fill consent), then use the Fill bookmark here.');
    }

    // ---------- signature ink: if any box has been signed, this run must not reload the page
    var inked = Array.prototype.some.call(document.querySelectorAll('canvas'), function (cv) {
      try {
        // Blank = every pixel the same colour as the first (works for clear or white backgrounds).
        var d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        for (var i = 0; i < d.length; i += 16)
          if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2] || d[i + 3] !== d[3]) return true;
      } catch (e) {}
      return false;
    });
    // Start one of the site's own reloads ~0.4 s AFTER answering the Shortcut, so the answer gets
    // back before the page goes away. The trigger runs in the page itself (an injected script)
    // so it survives this script ending; if the page blocks that, a timer here does it.
    // The Shortcut loses the page when it reloads, so a reload is always the LAST thing a run does.
    var startReload = function (trigger) {
      var code = 'setTimeout(function(){' + trigger + '},400);';
      try {
        var sc = document.createElement('script');
        sc.textContent = "document.documentElement.setAttribute('data-cf','1');" + code;
        (document.head || document.documentElement).appendChild(sc);
        sc.remove();
      } catch (e) {}
      if (document.documentElement.getAttribute('data-cf') !== '1') setTimeout(new Function(trigger), 400);
      document.documentElement.removeAttribute('data-cf');
    };
    var reload = function (prep, trigger, msg) {
      if (inked) return done('⚠️ A signature is already on this page, so I won\'t reload it. ' + msg);
      prep(); startReload(trigger);
      return done('🔄 ' + msg + '\nNext: when the page has reloaded, Fill again.');
    };
    var fire = function (id) { return "document.getElementById('" + id + "').dispatchEvent(new Event('change',{bubbles:true}));"; }; // the site's own onchange reloads

    // Registrar (Dr's user): the block's "registrar:" if given (a name, subspecialty or ID), else the first line.
    if (!staff.dr.length) return done('⚠️ No registrar in the staff list.');
    var dr = staff.dr[0], drNote = '', wantDr = String((c && c.registrar) || me.registrar || '').trim();
    if (wantDr) {
      dr = find(staff.dr, wantDr) || staff.dr.filter(function (x) { return low(x.id) === low(wantDr); })[0] || null;
      if (!dr && /^kk\d+$/i.test(wantDr)) dr = { id: wantDr, name: wantDr };
      if (!dr) { dr = staff.dr[0]; drNote = ' — "' + wantDr + '" is not on the staff list, so the default was used'; }
    }

    // Hospital dropdown: choose it if empty (staff list "hospital:" line, else KKUH).
    var hosp = $('hospital');
    if (hosp && !hosp.value && !inked) {
      var want = low(me.hospital || staff.hospital || 'KKUH');
      Array.prototype.some.call(hosp.options, function (o) {
        if (low(o.text) === want || low(o.value) === want) { hosp.value = o.value; o.selected = true; return true; }
        return false;
      });
    }

    // ---------- 1. patient not loaded yet → fill everything now, type the MRN LAST and let its reload
    // load the patient (the site keeps fields filled before a reload). One tap. (2026-10-11)
    var targetMrn = digits(c && mem ? mem.mrn : '');
    // A block without an MRN (colleagues type it in the popup) never brings back a remembered
    // one, except on the blood tab once, right after its surgical form: the same block may be
    // reused for the next patient.
    if (c && !blockMrn && !askedMrn && !(form === 'blood' && mem && mem.filled && mem.filled.surgical && !mem.filled.blood)) targetMrn = '';
    var after = ''; // the reload to start once everything is filled
    if (!val('MRN') || !val('ptName')) {
      if (!c) return done('⚠️ No consent block copied. Copy the block from your AI first.' + diag);
      if (!targetMrn && viaShortcut) return done('🔢 MRN needed');
      if (!targetMrn) return done('⚠️ No MRN. Use Share → Fill consent, or type the MRN in the form.' + diag);
      if (inked) return done('⚠️ A signature is already on this page and the patient isn\'t loaded. Open a fresh form.');
      if (low(val('drNo')) !== low(dr.id)) $('drNo').value = dr.id;
      $('MRN').value = targetMrn;
      after = fire('MRN');
    } else {
      if (targetMrn && digits(val('MRN')) !== targetMrn)
        return done('⚠️ This tab has a different patient (' + val('ptName') + ') from the copied consent. Nothing changed.');
      var blank = !(form === 'surgical' ? val('surNameEn') : val('bloodProduct'));
      // A form about to be filled gets the block's registrar even if another Dr's user is already in.
      if ((blank && low(val('drNo')) !== low(dr.id)) || (!val('doctorNoEn') && !val('doctorName'))) {
        if (inked) return done('⚠️ A signature is already on this page, so I won\'t change Dr\'s user.');
        $('drNo').value = dr.id; after = fire('drNo');
      }
    }
    var patient = val('ptName') || 'Patient loading';

    var people = function () {
      // Resident (witness 2): the block's "resident:" if given; a full name not on the list is used as written.
      var resident = null, residentNote = '', rq = String(c.resident || me.resident || '').trim();
      if (rq) {
        resident = find(staff.resident, rq);
        if (!resident && /\s/.test(rq)) { resident = { id: '', name: titled(rq) }; residentNote = ' (not on the staff list)'; }
        if (!resident) residentNote = ' — "' + rq + '" is not on the staff list: type the full name';
      } else resident = staff.resident[0] || null;
      // Several consultants on the list → never guess; one → it's the default. A surname not on
      // the list is used as written and flagged.
      var consultant = find(staff.consultant, c.consultant), consultantNote = '';
      if (!consultant && c.consultant) { consultant = { name: titled(c.consultant) }; consultantNote = ' (not on the staff list — check the spelling)'; }
      if (!consultant && staff.consultant.length === 1) consultant = staff.consultant[0];
      if (!consultant) consultantNote = 'not given — type it in';
      var nurse = null, unknown = '', q = String((mem && mem.nurse) || c.nurse || '').trim();
      if (q && !/^(none|no|-)$/i.test(q)) {
        var inline = q.split('|').map(function (x) { return x.trim(); });
        if (inline.length >= 3) nurse = { id: inline[1], name: inline[2] };
        else {
          nurse = find(staff.nurse, q);
          // Not on the list: a full name is used as written; a single first name can't be.
          if (!nurse && /\s/.test(q)) { nurse = { id: '', name: q.replace(/\b\w/g, function (ch) { return ch.toUpperCase(); }) }; nurse.unlisted = !(mem && mem.nurseAdded === nurse.name); }
          // The Shortcut asked for the full name: someone already on the list (the block had a typo)
          // is used; a new first and last name is used and added to the shared Sheet.
          if (!nurse && answer && !/^(-|none|no)$/i.test(answer)) {
            nurse = find(staff.nurse, answer);
            if (!nurse) {
              var full = titled(answer.replace(/\s+/g, ' ')), w = low(full).split(' ');
              var taken = function (k) { return staff.nurse.some(function (x) { return x.key === k; }); };
              var key = [low(q), w[0], w[0] + (w[1] || '').charAt(0)].filter(function (k) { return /^[a-z][a-z'-]+$/.test(k) && !taken(k); })[0];
              nurse = { id: '', name: full, key: key };
              if (w.length > 1 && key && /^[A-Za-z' -]{3,60}$/.test(full)) nurse.added = true; else nurse.unlisted = true;
            }
          }
          if (!nurse && !(answer && /^(-|none|no)$/i.test(answer))) unknown = q;
        }
      }
      return { resident: resident, residentNote: residentNote, consultant: consultant, consultantNote: consultantNote, nurse: nurse, unknown: unknown };
    };
    var setv = function (id, v) {
      var e = $(id); if (!e) return;
      e.value = v == null ? '' : v;
      e.dispatchEvent(new Event('input', { bubbles: true }));
    };
    var setBoth = function (id, v) { setv(id, v); setv(id + 'Ar', v); };
    var tick = function (id, on) { var e = $(id); if (e) e.checked = !!on; };

    // Nurse buttons under the witness box. Inline onclick so they keep working after this script ends.
    var nurseButtons = function () {
      var w = $('WitnessName'); if (!w || $('cfNurses') || !staff.nurse.length) return;
      var box = document.createElement('div');
      box.id = 'cfNurses';
      box.style.cssText = 'margin:8px 0;padding:8px;border:2px solid #e8a400;border-radius:8px;font:14px -apple-system,sans-serif';
      box.innerHTML = '<div style="margin-bottom:6px">Witness nurse:</div>' + staff.nurse.map(function (n) {
        var js = "var s=function(i,v){var e=document.getElementById(i);if(e)e.value=v;};" +
          "s('WitnessId'," + JSON.stringify(n.id) + ");s('WitnessIdAr'," + JSON.stringify(n.id) + ");" +
          "s('WitnessName'," + JSON.stringify(n.name) + ");s('WitnessNameAr'," + JSON.stringify(n.name) + ");" +
          "try{var k='" + KEY + "',m=JSON.parse(localStorage.getItem(k)||'{}');m.nurse=" + JSON.stringify(n.key) + ";localStorage.setItem(k,JSON.stringify(m));}catch(x){}" +
          "Array.prototype.forEach.call(this.parentNode.querySelectorAll('button'),function(b){b.style.background='#fff'});this.style.background='#ffe08a';return false;";
        return '<button type="button" onclick="' + js.replace(/"/g, '&quot;') + '" style="margin:3px;padding:8px 12px;border:1px solid #999;border-radius:6px;background:#fff;font-size:15px">' +
          n.name.split(' ')[0] + '</button>';
      }).join('');
      w.parentNode.insertBefore(box, w.nextSibling);
    };

    var filled = form === 'surgical' ? !!val('surNameEn') : !!val('bloodProduct');

    // ---------- 2. loaded but empty → fill everything (no reload)
    if (!filled) {
      if (!c) return done('⚠️ ' + patient + ': no consent block copied. Copy the block from your AI first.' + diag);
      if (form === 'surgical' && !(c.procedure && c.complications && c['procedure ar'] && c['complications ar']))
        return done('⚠️ The copied block has no procedure or complications. For a surgical consent, copy the whole block.');
      var p = people();
      if (p.unknown && canAsk && !answer)
        return done('❓ Nurse "' + p.unknown + '" isn\'t on the staff list.\nType the nurse\'s full name (first and last): it will be added for everyone. Type - for no nurse.');
      if (form === 'surgical') {
        setBoth('doctorFollow', p.consultant ? p.consultant.name : '');
        setv('surNameEn', c.procedure); setv('procedure', c.complications);
        setv('surNameAr', c['procedure ar']); setv('procedureAr', c['complications ar']);
        tick('General', true); tick('GeneralAr', true);
      } else {
        setv('bloodProduct', 'PRBCs and blood products'); setv('purpose', 'If needed'); setv('complications', 'Allergy');
        setv('bloodProductAr', 'كريات الدم الحمراء ومشتقات الدم'); setv('purposeAr', 'عند الحاجة'); setv('complicationsAr', 'حساسية');
      }
      var high = /^(yes|y|true)$/i.test(String(c['high risk'] || ''));
      tick(form === 'surgical' ? 'termcheck' : 'isHigh', high);
      tick(form === 'surgical' ? 'termcheckAr' : 'isHightAr', high);
      setBoth('WitnessId', p.nurse ? p.nurse.id : ''); setBoth('WitnessName', p.nurse ? p.nurse.name : '');
      setBoth('TranslatorId', p.resident ? p.resident.id : ''); setBoth('TranslatorName', p.resident ? p.resident.name : '');
      // The patient on the page is the one remembered (a reused block may carry an older one).
      if (!mem || (digits(val('MRN')) && mem.mrn !== digits(val('MRN')))) mem = { mrn: digits(val('MRN')), block: c };
      mem.filled = mem.filled || {}; mem.filled[form] = true;
      if (p.nurse && (p.nurse.added || p.nurse.unlisted)) mem.nurse = p.nurse.name; // the blood tab doesn't ask again
      if (p.nurse && p.nurse.added) {
        mem.nurseAdded = p.nurse.name;
        // Sent even if the page reloads straight after (keepalive); the Sheet answer can't be read here.
        if (ADD_URL) try { fetch(ADD_URL, { method: 'POST', mode: 'no-cors', keepalive: true, body: JSON.stringify({ key: p.nurse.key, name: p.nurse.name }) }); } catch (e) {}
      }
      save(mem);
      nurseButtons();
      var openBlood = form === 'surgical';
      if (after) startReload(after);
      var notes = [p.consultantNote && p.consultantNote !== 'not given — type it in' ? 'Consultant ' + (p.consultant ? p.consultant.name : '') + p.consultantNote : '',
        form === 'surgical' && !p.consultant ? 'No consultant: type it in.' : '',
        p.nurse && p.nurse.unlisted ? 'Nurse ' + p.nurse.name + ' is not on the staff list.' : '',
        p.nurse && p.nurse.added && !ADD_URL ? 'Nurse ' + p.nurse.name + ' is not on the staff list: add them to the Sheet.' : '',
        p.unknown ? 'Nurse "' + p.unknown + '" is not on the staff list: type the full name.' : '',
        drNote ? 'Registrar' + drNote + '.' : '', p.residentNote ? 'Witness 2' + p.residentNote + '.' : ''].filter(Boolean);
      return done('✅ ' + (after ? cap(form) : patient + ' — ' + form) + ' consent filled.\n' +
        [form === 'surgical' && p.consultant ? p.consultant.name : '', p.nurse ? 'nurse ' + p.nurse.name.split(' ')[0] : 'no nurse',
          'registrar ' + (dr.name || dr.id).split(' — ')[0].split(' ')[0], p.resident ? 'witness ' + p.resident.name.split(' ')[0] : '', high ? 'HIGH RISK' : ''].filter(Boolean).join(' · ') +
        (p.nurse && p.nurse.added && ADD_URL ? '\n➕ ' + p.nurse.name + ' added to the staff list for everyone.' : '') +
        (notes.length ? '\n⚠️ ' + notes.join('\n⚠️ ') : '') +
        '\nNext: ' + (after ? 'check the patient\'s name when the page reloads. ' : '') +
        (openBlood ? 'Opening the blood consent: there, Share → Fill consent.' : (after ? 'Then at' : 'At') + ' the bedside, tap who signs on each form.'));
    }

    // ---------- 3. already filled → hand the signer between the tabs; offer the nurse buttons
    if (after) return reload(function () {}, after, 'Loading the patient.');
    nurseButtons();
    var radios = { patient: 'patientSign', guardian: 'GuardianSign', relative: 'RelativeSign' };
    var pageSigner = null;
    Object.keys(radios).forEach(function (k) { if ($(radios[k]) && $(radios[k]).checked) pageSigner = k; });
    var signer = mem && mem.signer && digits(mem.signer.mrn) === digits(val('MRN')) ? mem.signer : null;
    var describe = function (s) { return cap(s.type) + (s.type !== 'patient' && s.name ? ' — ' + s.name : '') + (s.relation ? ' (' + s.relation + ')' : ''); };

    if (!pageSigner) {
      if (signer && signer.form !== form) {
        // The site clears the signer's name when a signer radio is tapped, so the user taps it here
        // first, then Fill puts the name and relation in (branch below).
        return done('👉 ' + patient + '\nNext: tap ' + cap(signer.type) + ' on this form' +
          (signer.type === 'patient' ? ' (the name fills itself).' : ', then Fill again to add ' + describe(signer).replace(/^\w+ — /, '') + '.'));
      }
      return done('✅ ' + patient + ' — already filled.\nNext: tap who signs.' +
        (staff.nurse.length ? ' Different nurse? Tap her name in the yellow box.' : ''));
    }
    var pageRel = pageSigner === 'relative' ? val('RelativeRelation') : '';
    if (signer && signer.form !== form && signer.type === pageSigner) {
      if (pageSigner === 'relative' && signer.relation) setv('RelativeRelation', signer.relation);
      if (pageSigner !== 'patient' && signer.name) setv('nameofSing', signer.name);
      return done('✅ ' + patient + ' — signer copied: ' + describe(signer) + '.\nNext: the signature.');
    }
    mem = mem || { mrn: digits(val('MRN')) };
    mem.signer = { form: form, mrn: digits(val('MRN')), type: pageSigner, name: val('nameofSing'), relation: pageRel };
    save(mem);
    var other = form === 'surgical' ? 'blood' : 'surgical';
    return done('✅ ' + patient + ' — signer saved: ' + describe(mem.signer) + '.\nNext: on the ' + other + ' tab, tap ' + cap(pageSigner) + (pageSigner === 'patient' ? ' (nothing else needed).' : ', then Fill there to add the name' + (pageSigner === 'relative' ? ' and relation.' : '.')) +
      (staff.nurse.length ? '\nDifferent nurse? Tap her name in the yellow box.' : ''));
  } catch (err) {
    return done('⚠️ Filler crashed: ' + (err && err.message));
  }
})();
