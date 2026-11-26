/* app.js: page logic. It only calls the API object from api.js. */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SLOTS = [8, 9, 10, 11, 12, 13, 14, 15, 16];
const lbl = h => (h % 12 || 12) + ':00 ' + (h < 12 ? 'AM' : 'PM');
const fmt = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const today = () => fmt(new Date());
const ROLE = { regular: 'Regular', vip: 'VIP', admin: 'Admin' };
let me = null, editId = null;

function say(id, text, ok) { $(id).innerHTML = text ? '<div class="msg ' + (ok ? 'ok' : 'err') + '">' + esc(text) + '</div>' : ''; }
async function run(fn, msgId) { try { await fn(); } catch (e) { say(msgId, e.message); } }

/* ---------- auth ---------- */
$('toSignup').onclick = e => { e.preventDefault(); $('loginForm').hidden = true; $('signupForm').hidden = false; say('authMsg', ''); };
$('toLogin').onclick = e => { e.preventDefault(); $('signupForm').hidden = true; $('loginForm').hidden = false; say('authMsg', ''); };
$('loginForm').onsubmit = e => { e.preventDefault(); run(async () => { me = await API.login($('lEmail').value, $('lPass').value); await enter(); }, 'authMsg'); };
$('signupForm').onsubmit = e => {
  e.preventDefault();
  run(async () => {
    if ($('sPass').value !== $('sPass2').value) throw new Error('Passwords do not match.');
    me = await API.signup({ name: $('sName').value, email: $('sEmail').value, password: $('sPass').value, role: document.querySelector('input[name=sRole]:checked').value });
    await enter();
  }, 'authMsg');
};
$('logout').onclick = async () => { await API.logout(); me = null; leave(); };

async function enter() {
  const admin = me.role === 'admin';
  $('auth').hidden = true; $('userbox').hidden = false;
  $('uname').textContent = me.name;
  $('urole').textContent = ROLE[me.role]; $('urole').className = 'pill ' + me.role;
  $('tabs').hidden = false; $('tabBtn').textContent = admin ? 'Manage PCs' : 'Reservations';
  $('rCust').value = me.name + ' (' + ROLE[me.role] + ')';
  // Role gating: admins see Manage PCs only, customers see Reservations only.
  // (The backend must enforce this too; hiding things here is only for the interface.)
  $('admin').hidden = !admin; $('reserve').hidden = admin;
  await loadBranches();
  if (admin) refreshAdmin(); else { refreshGrid(); refreshMine(); }
}
function leave() {
  $('auth').hidden = false; $('userbox').hidden = true; $('tabs').hidden = true; $('admin').hidden = true; $('reserve').hidden = true;
  $('loginForm').reset(); say('authMsg', '');
}

async function loadBranches() {
  const bs = await API.getBranches();
  ['rBranch', 'aBranch'].forEach(id => {
    const cur = $(id).value;
    $(id).innerHTML = bs.map(b => '<option value="' + b.id + '">' + esc(b.name) + '</option>').join('');
    if (bs.some(b => b.id === cur)) $(id).value = cur;
  });
}

/* ---------- customer: availability + reservations ---------- */
async function refreshGrid() {
  const b = $('rBranch').value, d = $('rDate').value;
  if (!b || !d) { $('grid').innerHTML = ''; $('rPc').innerHTML = ''; return; }
  const [pcs, res] = await Promise.all([API.getPCs(b), API.getReservations(b, d)]);
  const vip = me.role === 'vip', keep = $('rPc').value;
  $('rPc').innerHTML = pcs.filter(p => p.status === 'Available' && (vip || p.type === 'Standard')).map(p => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('');
  if (keep) $('rPc').value = keep;
  let h = '<tr><th class="l">PC</th>' + SLOTS.map(s => '<th>' + lbl(s).replace(':00', '') + '</th>').join('') + '</tr>';
  pcs.forEach(p => {
    h += '<tr><td class="l' + (p.type === 'VIP' ? ' vipname' : '') + '"><b>' + esc(p.name) + (p.type === 'VIP' ? ' · VIP' : '') + '</b></td>';
    SLOTS.forEach(s => {
      const taken = res.some(r => r.pcId === p.id && r.slot === s);
      if (p.status !== 'Available') h += '<td class="c off">Fix</td>';
      else if (p.type === 'VIP' && !vip) h += '<td class="c lock">VIP only</td>';
      else if (taken) h += '<td class="c busy">Booked</td>';
      else h += '<td class="c free' + (p.id === $('rPc').value && s === Number($('rSlot').value) ? ' sel' : '') + '" data-pc="' + p.id + '" data-s="' + s + '">Free</td>';
    });
    h += '</tr>';
  });
  $('grid').innerHTML = h;
  refreshShops();
}
async function refreshShops() {
  const d = $('rDate').value, s = Number($('rSlot').value), cur = $('rBranch').value;
  if (!d) return;
  const av = await API.getAvailability(d, s);
  $('shops').innerHTML = av.map(a => '<button type="button" class="shop' + (a.branchId === cur ? ' on' : '') + (a.free ? '' : ' full') + '" data-b="' + a.branchId + '"><b>' + esc(a.name) + '</b><small>' + (a.free ? a.free + ' PC' + (a.free === 1 ? '' : 's') + ' free' : 'Full') + '</small></button>').join('');
  const here = av.find(a => a.branchId === cur), alts = av.filter(a => a.free && a.branchId !== cur).sort((x, y) => y.free - x.free);
  $('fullMsg').innerHTML = here && !here.free
    ? '<div class="banner"><span><b>' + esc(here.name) + '</b> is full at ' + lbl(s) + '.' + (alts.length ? ' Try another shop:' : ' All shops are full at this time. Try a different time slot.') + '</span>' +
      alts.map(a => '<button type="button" data-b="' + a.branchId + '">' + esc(a.name) + ' (' + a.free + ' free)</button>').join('') + '</div>'
    : '';
}
$('shops').onclick = $('fullMsg').onclick = e => {
  const b = e.target.closest('[data-b]'); if (!b) return;
  $('rBranch').value = b.dataset.b; say('rMsg', ''); refreshGrid();
};
$('rSlot').onchange = () => { say('rMsg', ''); refreshGrid(); };
async function refreshMine() {
  const list = await API.myReservations();
  $('mine').innerHTML = list.length ? list.map(r =>
    '<div class="item"><div><b>' + lbl(r.slot) + ' · ' + esc(r.pcName) + '</b><div class="meta">' + esc(r.branchName) + ' · ' + r.date + '</div></div><button class="d" data-cancel="' + r.id + '">Cancel</button></div>'
  ).join('') : '<p class="meta">No reservations yet.</p>';
}
$('rBranch').onchange = () => { say('rMsg', ''); refreshGrid(); };
$('rDate').onchange = () => { say('rMsg', ''); refreshGrid(); };
$('grid').onclick = e => {
  const c = e.target.closest('.free'); if (!c) return;
  $('rPc').value = c.dataset.pc; $('rSlot').value = c.dataset.s; say('rMsg', ''); refreshGrid();
};
$('book').onclick = () => run(async () => {
  await API.reserve({ pcId: $('rPc').value, date: $('rDate').value, slot: Number($('rSlot').value) });
  say('rMsg', 'Reservation saved.', 1); refreshGrid(); refreshMine();
}, 'rMsg');
$('mine').onclick = e => {
  const id = e.target.dataset.cancel; if (!id) return;
  run(async () => { await API.cancel(id); refreshGrid(); refreshMine(); }, 'rMsg');
};

/* ---------- admin: manage branches and PCs ---------- */
async function refreshAdmin() {
  const b = $('aBranch').value;
  const pcs = b ? await API.getPCs(b) : [];
  $('pcList').innerHTML = pcs.length ? pcs.map(p =>
    '<div class="item"><div><b>' + esc(p.name) + '</b> <span class="pill' + (p.type === 'VIP' ? ' vip' : '') + '">' + p.type + '</span> <span class="pill ' + (p.status === 'Maintenance' ? 'warn' : 'okp') + '">' + p.status + '</span><div class="meta">' + esc(p.specs) + '</div></div>' +
    '<div><button data-edit="' + p.id + '">Edit</button> <button class="d" data-del="' + p.id + '">Delete</button></div></div>'
  ).join('') : '<p class="meta">No PCs in this shop yet.</p>';
  refreshAdminRes();
}
async function refreshAdminRes() {
  const b = $('aBranch').value, d = $('aDate').value;
  if (!b || !d) { $('aRes').innerHTML = ''; return; }
  const list = await API.adminReservations(b, d);
  $('aRes').innerHTML = list.length ? list.map(r =>
    '<div class="item"><div><b>' + lbl(r.slot) + ' · ' + esc(r.pcName) + '</b> <span class="pill ' + r.userRole + '">' + ROLE[r.userRole] + '</span><div class="meta">' + esc(r.userName) + ' · ' + esc(r.userEmail) + '</div></div><button class="d" data-acancel="' + r.id + '">Cancel</button></div>'
  ).join('') : '<p class="meta">No reservations in this shop on this date.</p>';
}
$('aDate').onchange = refreshAdminRes;
$('aRes').onclick = e => {
  const id = e.target.dataset.acancel; if (!id) return;
  run(async () => { if (!confirm('Cancel this reservation?')) return; await API.cancel(id); refreshAdminRes(); }, 'aMsg');
};
function clearForm() {
  editId = null; $('aName').value = $('aSpecs').value = ''; $('aType').value = 'Standard'; $('aStatus').value = 'Available';
  $('aTitle').textContent = 'Add a PC'; $('aSave').textContent = 'Add PC'; $('aCancel').hidden = true;
}
$('aBranch').onchange = () => { clearForm(); say('aMsg', ''); refreshAdmin(); };
$('addBranch').onclick = () => run(async () => { await API.addBranch($('bName').value); $('bName').value = ''; await loadBranches(); refreshAdmin(); say('aMsg', 'Shop added.', 1); }, 'aMsg');
$('delBranch').onclick = () => run(async () => {
  if (!$('aBranch').value || !confirm('Delete this shop with all its PCs and reservations?')) return;
  await API.deleteBranch($('aBranch').value); clearForm(); await loadBranches(); refreshAdmin();
}, 'aMsg');
$('aSave').onclick = () => run(async () => {
  await API.savePC({ id: editId, branchId: $('aBranch').value, name: $('aName').value, specs: $('aSpecs').value, type: $('aType').value, status: $('aStatus').value });
  clearForm(); say('aMsg', 'Saved.', 1); refreshAdmin();
}, 'aMsg');
$('aCancel').onclick = () => { clearForm(); say('aMsg', ''); };
$('pcList').onclick = e => run(async () => {
  const ed = e.target.dataset.edit, dl = e.target.dataset.del;
  if (ed) {
    const p = (await API.getPCs($('aBranch').value)).find(x => x.id === ed);
    editId = ed; $('aName').value = p.name; $('aSpecs').value = p.specs; $('aType').value = p.type; $('aStatus').value = p.status;
    $('aTitle').textContent = 'Edit PC'; $('aSave').textContent = 'Save changes'; $('aCancel').hidden = false; say('aMsg', '');
  }
  if (dl && confirm('Delete this PC and its reservations?')) { await API.deletePC(dl); refreshAdmin(); }
}, 'aMsg');

function shiftDate(n) {
  const d = new Date($('rDate').value + 'T00:00:00'); d.setDate(d.getDate() + n);
  const v = fmt(d); if (v < today()) return;
  $('rDate').value = v; say('rMsg', ''); refreshGrid();
}
$('prevDay').onclick = () => shiftDate(-1); $('nextDay').onclick = () => shiftDate(1);

/* ---------- light / dark mode ---------- */
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('shopslot:theme', t); } catch (e) {}
  $('themeBtn').textContent = t === 'dark' ? '☀ Light mode' : '☾ Dark mode';
}
$('themeBtn').onclick = () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
setTheme(document.documentElement.getAttribute('data-theme') || 'light');

/* ---------- start ---------- */
$('rSlot').innerHTML = SLOTS.map(s => '<option value="' + s + '">' + lbl(s) + '</option>').join('');
$('rDate').value = today(); $('rDate').min = today(); $('aDate').value = today();
API.currentUser().then(u => { if (u) { me = u; enter(); } });
