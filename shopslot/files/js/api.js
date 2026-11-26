/*
  api.js: the ONLY file that talks to data.
  Right now it is a mock that stores everything in the browser (localStorage).
  To connect your Express backend, replace each function body with a fetch() call
  to the route shown in its comment. app.js does not need to change.
  Demo admin login: admin@shop.com / admin123
  NOTE: the real backend must hash passwords (bcrypt) and enforce roles on every route.
*/
const API = (() => {
  const KEY = 'shopslot:db2';
  const LIMIT = { regular: 2, vip: 4 };
  const uid = () => Math.random().toString(36).slice(2, 10);
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const fail = m => { throw new Error(m); };

  function seed() {
    // Shop names only. The PCs below are sample data: the admin can edit them in Manage PCs.
    const b = ['KDM Esports Cafe', 'Kadiliman Esports Cafe', 'TNC Cyber Cafe', 'Mineski Infinity', 'High Grounds Cafe'].map(n => ({ id: uid(), name: n }));
    const SIZES = [3, 6, 6, 8, 6];
    const pcs = [];
    b.forEach((br, i) => {
      const n = SIZES[i];
      for (let k = 1; k <= n; k++) {
        const vip = k > n - Math.ceil(n / 4);
        pcs.push({ id: uid(), branchId: br.id, name: 'PC-0' + k, specs: vip ? 'i7, 32GB RAM, RTX 4070' : 'i5, 16GB RAM, GTX 1650', type: vip ? 'VIP' : 'Standard', status: 'Available' });
      }
    });
    return { users: [{ id: uid(), name: 'Shop Admin', email: 'admin@shop.com', password: 'admin123', role: 'admin' }], branches: b, pcs, reservations: [], session: null };
  }
  function load() {
    try { const r = localStorage.getItem(KEY); if (r) { const o = JSON.parse(r); if (o && o.users) return o; } } catch (e) {}
    return seed();
  }
  let db = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} };
  const me = () => db.users.find(u => u.id === db.session);
  const safe = u => u && { id: u.id, name: u.name, email: u.email, role: u.role };
  const needUser = () => { const u = me(); if (!u) fail('Please log in first.'); return u; };
  const needAdmin = () => { const u = needUser(); if (u.role !== 'admin') fail('Admins only.'); return u; };
  const ok = v => Promise.resolve(v);
  const run = fn => { try { return ok(fn()); } catch (e) { return Promise.reject(e); } };

  return {
    // POST /api/auth/signup
    signup: d => run(() => {
      const name = (d.name || '').trim(), email = (d.email || '').trim().toLowerCase();
      if (!name || !email || !d.password) fail('Please fill in all fields.');
      if (!['regular', 'vip'].includes(d.role)) fail('Choose Regular or VIP.');
      if (db.users.some(u => u.email === email)) fail('That email is already registered.');
      const u = { id: uid(), name, email, password: d.password, role: d.role };
      db.users.push(u); db.session = u.id; save(); return safe(u);
    }),
    // POST /api/auth/login
    login: (email, password) => run(() => {
      const u = db.users.find(x => x.email === (email || '').trim().toLowerCase() && x.password === password);
      if (!u) fail('Wrong email or password.');
      db.session = u.id; save(); return safe(u);
    }),
    // POST /api/auth/logout (or just delete the token on the client)
    logout: () => run(() => { db.session = null; save(); }),
    // GET /api/auth/me
    currentUser: () => run(() => safe(me()) || null),

    // GET /api/branches
    getBranches: () => run(() => db.branches.slice()),
    // GET /api/branches/availability?date=&slot=   (free PCs per shop at that time, for the logged-in user's role)
    getAvailability: (date, slot) => run(() => {
      const u = needUser();
      return db.branches.map(b => ({
        branchId: b.id, name: b.name,
        free: db.pcs.filter(p => p.branchId === b.id && p.status === 'Available' && (p.type === 'Standard' || u.role === 'vip') &&
          !db.reservations.some(r => r.pcId === p.id && r.date === date && r.slot === slot)).length
      }));
    }),
    // POST /api/branches   (admin)
    addBranch: name => run(() => {
      needAdmin(); name = (name || '').trim(); if (!name) fail('Enter a shop name.');
      if (db.branches.some(b => b.name.toLowerCase() === name.toLowerCase())) fail('That shop already exists.');
      db.branches.push({ id: uid(), name }); save();
    }),
    // DELETE /api/branches/:id   (admin)
    deleteBranch: id => run(() => {
      needAdmin();
      const ids = db.pcs.filter(p => p.branchId === id).map(p => p.id);
      db.reservations = db.reservations.filter(r => !ids.includes(r.pcId));
      db.pcs = db.pcs.filter(p => p.branchId !== id);
      db.branches = db.branches.filter(b => b.id !== id); save();
    }),

    // GET /api/branches/:id/pcs
    getPCs: branchId => run(() => db.pcs.filter(p => p.branchId === branchId)),
    // POST /api/pcs (new) or PUT /api/pcs/:id (existing)   (admin)
    savePC: pc => run(() => {
      needAdmin();
      if (!pc.name.trim()) fail('PC name is required.');
      if (db.pcs.some(p => p.branchId === pc.branchId && p.id !== pc.id && p.name.toLowerCase() === pc.name.trim().toLowerCase())) fail('A PC with that name already exists in this branch.');
      if (pc.id) { Object.assign(db.pcs.find(p => p.id === pc.id), { name: pc.name.trim(), specs: pc.specs, type: pc.type, status: pc.status }); }
      else db.pcs.push({ id: uid(), branchId: pc.branchId, name: pc.name.trim(), specs: pc.specs, type: pc.type, status: pc.status });
      save();
    }),
    // DELETE /api/pcs/:id   (admin)
    deletePC: id => run(() => {
      needAdmin(); db.pcs = db.pcs.filter(p => p.id !== id); db.reservations = db.reservations.filter(r => r.pcId !== id); save();
    }),

    // GET /api/reservations?branchId=&date=
    getReservations: (branchId, date) => run(() => {
      const ids = db.pcs.filter(p => p.branchId === branchId).map(p => p.id);
      return db.reservations.filter(r => r.date === date && ids.includes(r.pcId));
    }),
    // GET /api/admin/reservations?branchId=&date=   (admin: who booked what)
    adminReservations: (branchId, date) => run(() => {
      needAdmin();
      const ids = db.pcs.filter(p => p.branchId === branchId).map(p => p.id);
      return db.reservations.filter(r => r.date === date && ids.includes(r.pcId)).map(r => {
        const p = db.pcs.find(x => x.id === r.pcId) || {}, u = db.users.find(x => x.id === r.userId) || {};
        return { id: r.id, slot: r.slot, pcName: p.name, userName: u.name, userEmail: u.email, userRole: u.role };
      }).sort((a, b) => a.slot - b.slot);
    }),
    // GET /api/reservations/mine
    myReservations: () => run(() => {
      const u = needUser();
      return db.reservations.filter(r => r.userId === u.id).map(r => {
        const p = db.pcs.find(x => x.id === r.pcId) || {}, b = db.branches.find(x => x.id === p.branchId) || {};
        return { id: r.id, date: r.date, slot: r.slot, pcName: p.name, branchName: b.name };
      }).sort((a, b) => (a.date + String(a.slot).padStart(2, '0')).localeCompare(b.date + String(b.slot).padStart(2, '0')));
    }),
    // POST /api/reservations   body: { pcId, date, slot }
    reserve: ({ pcId, date, slot }) => run(() => {
      const u = needUser();
      if (u.role === 'admin') fail('Admin accounts cannot make reservations.');
      const pc = db.pcs.find(p => p.id === pcId); if (!pc) fail('Please choose a PC.');
      if (!date || date < today()) fail('You cannot book a date in the past.');
      if (pc.status !== 'Available') fail('That PC is under maintenance.');
      if (pc.type === 'VIP' && u.role !== 'vip') fail('That PC is for VIP users only.');
      if (db.reservations.some(r => r.pcId === pcId && r.date === date && r.slot === slot)) fail('That PC is already booked for that slot.');
      const mine = db.reservations.filter(r => r.userId === u.id && r.date === date);
      if (mine.some(r => r.slot === slot)) fail('You already have a PC at that time.');
      if (mine.length >= LIMIT[u.role]) fail('Limit reached: ' + u.role + ' users can book up to ' + LIMIT[u.role] + ' slots per day.');
      db.reservations.push({ id: uid(), userId: u.id, pcId, date, slot }); save();
    }),
    // DELETE /api/reservations/:id   (the owner, or an admin)
    cancel: id => run(() => {
      const u = needUser(); const r = db.reservations.find(x => x.id === id);
      if (!r || (r.userId !== u.id && u.role !== 'admin')) fail('You can only cancel your own reservations.');
      db.reservations = db.reservations.filter(x => x.id !== id); save();
    })
  };
})();
