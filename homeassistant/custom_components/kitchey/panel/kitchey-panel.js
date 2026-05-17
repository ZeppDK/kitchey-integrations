/**
 * kitchey-panel
 * Home Assistant sidebar panel for Kitchey: inventory, shopping list,
 * catalog and settings — including USB HID barcode scanner support.
 *
 * Registered automatically by the Kitchey integration (no YAML needed).
 * Credentials are fetched from /api/kitchey/config (HA-authed endpoint).
 */
'use strict';

(() => {
  const GREEN = '#4CAF82';
  const BG = '#f5f5f7';

  const CATEGORY_LABELS = { fridge: 'Køleskab', freezer: 'Fryser', pantry: 'Kolonial' };
  const CATEGORY_ICONS  = { fridge: '🧊', freezer: '❄️', pantry: '🥫' };

  const DIET_OPTIONS = [
    { key: 'gluten_free',   label: 'Glutenfri' },
    { key: 'dairy_free',    label: 'Mælkefri' },
    { key: 'lactose_free',  label: 'Laktosefri' },
    { key: 'nut_free',      label: 'Nødefri' },
    { key: 'vegetarian',    label: 'Vegetarisk' },
    { key: 'vegan',         label: 'Vegansk' },
  ];

  // ── Helpers ────────────────────────────────────────────────────────────────

  function daysUntil(dateStr) {
    if (!dateStr) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const exp   = new Date(dateStr.slice(0, 10)); exp.setHours(0, 0, 0, 0);
    return Math.round((exp - today) / 86400000);
  }

  function expiryBadge(dateStr) {
    const d = daysUntil(dateStr);
    if (d === null) return '';
    if (d < 0)  return `<span class="badge badge-crit">Udløbet</span>`;
    if (d <= 3) return `<span class="badge badge-crit">${d}d</span>`;
    if (d <= 7) return `<span class="badge badge-warn">${d}d</span>`;
    return `<span class="badge badge-ok">${d}d</span>`;
  }

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Panel component ────────────────────────────────────────────────────────

  class KitcheyPanel extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });

      // navigation
      this._tab = 'lager';
      this._editShopId = null;

      // credentials (from /api/kitchey/config)
      this._config = null;
      this._initing = false;

      // data
      this._inventory    = [];
      this._shopping     = [];
      this._catalog      = [];
      this._storageUnits = [];
      this._locations    = [];
      this._household    = null;
      this._profile      = null;
      this._preferences  = { filters: [] };

      // premium cache (30-min TTL)
      this._isPremium  = null;
      this._premiumTs  = 0;

      // UI state
      this._drawerItem    = null;
      this._addModal      = null; // { step:'search'|'new'|'confirm', form:{...}, search:'', error:null, saving:false }
      this._drawerOpened  = false;
      this._drawerOpenedAt = '';
      this._searchLager   = '';
      this._filterUnit    = 'all';
      this._searchShop    = '';
      this._searchCat     = '';
      this._filterCat     = 'all';
      this._errors        = {};

      // barcode scanner
      this._barcodeBuffer = '';
      this._barcodeTs     = 0;
      this._keyHandler    = this._onKeydown.bind(this);

      this._refreshTimer  = null;
    }

    // ── HA lifecycle ─────────────────────────────────────────────────────────

    set hass(h) {
      this._hass = h;
      if (!this._config && !this._initing) this._init();
    }

    async _init() {
      this._initing = true;
      this._renderLoading();

      try {
        const resp = await this._hass.fetchWithAuth('/api/kitchey/config');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        this._config = await resp.json();
      } catch (e) {
        this._renderFatal(`Kunne ikke hente Kitchey-konfiguration: ${e.message}`);
        return;
      }

      document.addEventListener('keydown', this._keyHandler);
      window._kitcheyBarcodeSim = (code) => this._handleBarcode(code);
      this._refreshTimer = setInterval(async () => {
        await this._fetchAll();
        this._render();
      }, 5 * 60 * 1000);

      await this._fetchAll();
      this._render();
    }

    disconnectedCallback() {
      document.removeEventListener('keydown', this._keyHandler);
      if (this._refreshTimer) clearInterval(this._refreshTimer);
    }

    // ── API helper ────────────────────────────────────────────────────────────

    async _api(method, path, body = null, authOnly = false) {
      const cfg = this._config;
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.token}`,
      };
      if (!authOnly) headers['X-Household-Id'] = cfg.household_id;

      const opts = { method, headers };
      if (body) opts.body = JSON.stringify(body);

      const r = await fetch(`${cfg.server_url}${path}`, opts);
      if (!r.ok) {
        let msg = `API ${r.status}`;
        try { const d = await r.json(); msg = d.message || d.error || msg; } catch { /* ignore */ }
        throw new Error(msg);
      }
      if (r.status === 204) return null;
      return r.json();
    }

    // ── Data fetching ─────────────────────────────────────────────────────────

    async _fetchAll() {
      try {
        const [inv, shop, units, cat, locs] = await Promise.all([
          this._api('GET', '/api/inventory'),
          this._api('GET', '/api/shopping'),
          this._api('GET', '/api/storage-units'),
          this._api('GET', '/api/catalog'),
          this._api('GET', '/api/locations'),
        ]);
        this._inventory    = inv   || [];
        this._shopping     = shop  || [];
        this._storageUnits = units || [];
        this._catalog      = cat   || [];
        this._locations    = locs  || [];
        delete this._errors.global;
      } catch (e) {
        this._errors.global = e.message;
      }
    }

    async _fetchSettings() {
      try {
        const [households, prof, pref] = await Promise.all([
          this._api('GET', '/api/households'),
          this._api('GET', '/api/auth/me', null, true),
          this._api('GET', '/api/preferences', null, true),
        ]);
        const hhList = Array.isArray(households) ? households : [households];
        const hh = hhList.find(h => h.id === this._config.household_id) || hhList[0] || null;
        this._household   = hh;
        this._profile     = prof;
        this._preferences = pref || { filters: [] };
        delete this._errors.settings;
      } catch (e) {
        this._errors.settings = e.message;
      }
    }

    async _checkPremium() {
      const now = Date.now();
      if (this._isPremium !== null && now - this._premiumTs < 30 * 60 * 1000) return;
      if (!this._config.is_official_server) { this._isPremium = true; return; }
      try {
        const d = await this._api('GET', '/api/premium/status', null, true);
        this._isPremium = !!d?.isPremium;
        this._premiumTs = now;
      } catch { this._isPremium = false; }
    }

    // ── Barcode scanner ───────────────────────────────────────────────────────

    _onKeydown(e) {
      // Don't intercept normal text input
      const tag = (e.target.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === 'Enter') {
        const buf = this._barcodeBuffer;
        this._barcodeBuffer = '';
        if (buf.length >= 8) this._handleBarcode(buf);
        return;
      }

      if (e.key.length !== 1) { this._barcodeBuffer = ''; return; }

      const now = Date.now();
      if (now - this._barcodeTs > 100) this._barcodeBuffer = '';
      this._barcodeBuffer += e.key;
      this._barcodeTs = now;
    }

    async _handleBarcode(code) {
      try {
        const r = await this._api('GET', `/api/barcode/${encodeURIComponent(code)}`);
        const product = r?.product;
        if (r?.source === 'local' && product) {
          // Found in local catalog → skip to confirm step
          this._openAddModal('confirm', this._formFromProduct(product, code));
        } else if (product) {
          // Found via external barcode API → pre-fill new product form
          this._openAddModal('new', this._formFromProduct(product, code));
        } else {
          // Not found → open new product with barcode pre-filled
          this._openAddModal('new', { ...this._emptyForm(), barcode: code });
        }
      } catch {
        this._openAddModal('new', { ...this._emptyForm(), barcode: code });
      }
    }

    _emptyForm() {
      return {
        product_id: null, name: '', brand: '', barcode: '',
        unit: 'stk', weight_per_unit: '', category: 'pantry',
        quantity: 1, location_id: '',
        expiry_date: '', date_added: new Date().toISOString().slice(0, 10),
        opened: false, notes: '',
      };
    }

    _formFromProduct(p, barcode = '') {
      return {
        product_id: p.id || null,
        name: p.name || '',
        brand: p.brand || '',
        barcode: p.barcode || barcode,
        unit: p.unit || 'stk',
        weight_per_unit: p.weight_per_unit || '',
        category: p.category || 'pantry',
        quantity: 1,
        location_id: p.default_location_id || '',
        expiry_date: '',
        date_added: new Date().toISOString().slice(0, 10),
        opened: false,
        notes: '',
      };
    }

    _openAddModal(step = 'search', form = null) {
      this._addModal = { step, form: form || this._emptyForm(), search: '', error: null, saving: false };
      this._render();
    }

    // ── Styles ────────────────────────────────────────────────────────────────

    _css() {
      return `
        :host { display:block; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background:${BG}; min-height:100vh; }
        * { box-sizing:border-box; margin:0; padding:0; }
        .panel { max-width:960px; margin:0 auto; padding:16px; }
        .nav { display:flex; gap:4px; margin-bottom:20px; background:#fff; border-radius:12px; padding:6px; box-shadow:0 1px 4px rgba(0,0,0,0.08); }
        .nav-btn { flex:1; padding:10px 8px; border:none; background:none; border-radius:8px; font-size:13px; font-weight:600; color:#666; cursor:pointer; transition:background .15s,color .15s; }
        .nav-btn.active { background:${GREEN}; color:#fff; }
        .card { background:#fff; border-radius:12px; box-shadow:0 1px 4px rgba(0,0,0,0.08); margin-bottom:16px; overflow:hidden; }
        .card-hdr { padding:14px 16px 10px; font-size:15px; font-weight:700; color:#1a1a1a; border-bottom:1px solid #f0f0f0; display:flex; align-items:center; justify-content:space-between; }
        .card-body { padding:12px 16px; }
        .srch { padding:8px 16px; }
        .srch-input { width:100%; padding:9px 12px; border:1px solid #e0e0e0; border-radius:8px; font-size:14px; outline:none; background:#fafafa; }
        .srch-input:focus { border-color:${GREEN}; background:#fff; }
        .filters { display:flex; gap:6px; padding:0 16px 8px; flex-wrap:wrap; }
        .f-btn { padding:4px 12px; border:1px solid #e0e0e0; border-radius:16px; background:none; font-size:12px; color:#666; cursor:pointer; }
        .f-btn.active { background:${GREEN}; color:#fff; border-color:${GREEN}; }
        .list { padding:0 0 8px; }
        .unit-section { margin-bottom:4px; }
        .unit-hdr { display:flex; align-items:center; gap:8px; padding:10px 16px 6px; background:${BG}; font-size:12px; font-weight:700; color:#555; text-transform:uppercase; letter-spacing:.05em; }
        .loc-hdr { padding:6px 16px 2px; font-size:11px; font-weight:600; color:#aaa; text-transform:uppercase; letter-spacing:.04em; }
        .row { display:flex; align-items:center; gap:10px; padding:10px 16px; }
        .row.clickable { cursor:pointer; }
        .row.clickable:hover { background:${BG}; }
        .info { flex:1; min-width:0; }
        .name { font-size:14px; font-weight:600; color:#1a1a1a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .sub { font-size:12px; color:#888; margin-top:2px; }
        .badge { display:inline-block; font-size:11px; font-weight:700; border-radius:6px; padding:2px 7px; flex-shrink:0; }
        .badge-ok   { background:rgba(76,175,130,.12); color:${GREEN}; }
        .badge-warn { background:rgba(255,152,0,.12); color:#ff9800; }
        .badge-crit { background:rgba(244,67,54,.12); color:#f44336; }
        .badge-grey { background:#f0f0f0; color:#888; }
        .btn { display:inline-flex; align-items:center; gap:6px; padding:9px 16px; border:none; border-radius:8px; font-size:14px; font-weight:600; cursor:pointer; }
        .btn:hover { opacity:.85; }
        .btn-primary { background:${GREEN}; color:#fff; }
        .btn-danger  { background:#f44336; color:#fff; }
        .btn-ghost   { background:#f0f0f0; color:#444; }
        .btn:disabled { opacity:.4; cursor:not-allowed; }
        .inp { width:100%; padding:9px 12px; border:1px solid #e0e0e0; border-radius:8px; font-size:14px; outline:none; background:#fff; }
        .inp:focus { border-color:${GREEN}; }
        .lbl { font-size:12px; font-weight:600; color:#666; margin-bottom:4px; display:block; }
        .frow { margin-bottom:12px; }
        .error-banner { background:rgba(244,67,54,.1); color:#c62828; border-radius:8px; padding:10px 14px; font-size:13px; margin:0 0 12px; }
        .empty { padding:24px 16px; text-align:center; color:#999; font-size:14px; }
        .lock-row { display:flex; align-items:flex-start; gap:8px; padding:10px 12px; background:#fffde7; border-radius:8px; font-size:12px; color:#f57f17; margin-top:6px; line-height:1.5; }
        .chevron { color:#ccc; font-size:18px; flex-shrink:0; }
        /* Drawer */
        .drawer-overlay { position:fixed; inset:0; background:rgba(0,0,0,.4); z-index:100; display:flex; align-items:flex-end; justify-content:center; }
        .drawer { background:#fff; border-radius:16px 16px 0 0; width:100%; max-width:600px; padding:20px 20px 32px; max-height:90vh; overflow-y:auto; }
        .drawer-handle { width:36px; height:4px; background:#e0e0e0; border-radius:2px; margin:0 auto 16px; }
        .drawer-title { font-size:17px; font-weight:700; margin-bottom:16px; }
        .drawer-actions { display:flex; gap:8px; margin-top:16px; flex-wrap:wrap; }
        /* Add modal */
        .modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,.5); z-index:200; display:flex; align-items:flex-end; justify-content:center; }
        .modal-sheet { background:#fff; border-radius:16px 16px 0 0; width:100%; max-width:640px; max-height:92vh; display:flex; flex-direction:column; }
        .modal-hdr { padding:12px 16px; border-bottom:1px solid #f0f0f0; display:flex; align-items:center; justify-content:space-between; flex-shrink:0; }
        .modal-title { font-size:16px; font-weight:700; }
        .modal-body { padding:16px; overflow-y:auto; flex:1; display:flex; flex-direction:column; gap:14px; }
        .modal-handle { width:36px; height:4px; background:#e0e0e0; border-radius:2px; margin:10px auto 0; }
        .cat-row { display:flex; align-items:center; gap:10px; padding:10px 12px; border:1px solid #f0f0f0; border-radius:10px; cursor:pointer; }
        .cat-row:hover { background:${BG}; }
        .cat-thumb { width:42px; height:42px; border-radius:8px; background:${BG}; display:flex; align-items:center; justify-content:center; font-size:20px; flex-shrink:0; overflow:hidden; }
        .cat-thumb img { width:100%; height:100%; object-fit:cover; }
        /* Stepper */
        .stepper { display:flex; align-items:center; gap:8px; }
        .step-btn { width:40px; height:40px; border:1px solid #e0e0e0; border-radius:8px; background:#fafafa; font-size:20px; font-weight:700; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
        .step-btn:hover { background:${BG}; }
        /* Opened toggle button */
        .opened-btn { width:100%; padding:10px; border-radius:8px; border:1px solid #e0e0e0; background:#fafafa; font-size:13px; cursor:pointer; text-align:left; transition:background .15s; }
        .opened-btn.on { background:rgba(255,165,0,.08); border-color:#ff9800; color:#e65100; }
        /* Shopping */
        .shop-row { display:flex; align-items:center; gap:10px; padding:10px 8px; border-radius:8px; }
        .check-circle { width:24px; height:24px; border-radius:50%; border:2px solid #ddd; cursor:pointer; flex-shrink:0; display:flex; align-items:center; justify-content:center; }
        .check-circle:hover { border-color:${GREEN}; }
        .del-btn { background:none; border:none; color:#f44336; cursor:pointer; font-size:15px; padding:4px; opacity:.5; flex-shrink:0; }
        .del-btn:hover { opacity:1; }
        .add-form { display:flex; gap:8px; padding:8px 16px 12px; flex-wrap:wrap; align-items:center; }
        .add-name { flex:1; min-width:130px; }
        .add-qty  { width:68px; }
        .add-unit { width:78px; }
        /* Settings */
        .unit-row { display:flex; align-items:center; gap:8px; padding:8px 0; border-bottom:1px solid #f0f0f0; }
        .unit-row:last-of-type { border-bottom:none; }
        .unit-name { flex:1; font-size:14px; }
        .unit-type { font-size:12px; color:#888; }
        .toggle-row { display:flex; align-items:center; justify-content:space-between; padding:11px 0; border-bottom:1px solid #f5f5f7; }
        .toggle-row:last-of-type { border-bottom:none; }
        .toggle-lbl { font-size:14px; color:#1a1a1a; }
        .toggle { position:relative; width:44px; height:24px; flex-shrink:0; }
        .toggle input { opacity:0; width:0; height:0; position:absolute; }
        .toggle-track { position:absolute; inset:0; background:#ddd; border-radius:12px; cursor:pointer; transition:background .2s; }
        .toggle input:checked + .toggle-track { background:${GREEN}; }
        .toggle-track::before { content:''; position:absolute; width:18px; height:18px; left:3px; top:3px; background:#fff; border-radius:50%; transition:transform .2s; }
        .toggle input:checked + .toggle-track::before { transform:translateX(20px); }
        /* Loading */
        .loading { display:flex; align-items:center; justify-content:center; height:240px; color:#888; font-size:15px; }
      `;
    }

    // ── Loading / fatal states ────────────────────────────────────────────────

    _renderLoading() {
      this.shadowRoot.innerHTML = `<style>${this._css()}</style><div class="panel"><div class="loading">Henter Kitchey-data…</div></div>`;
    }

    _renderFatal(msg) {
      this.shadowRoot.innerHTML = `<style>${this._css()}</style><div class="panel"><div class="error-banner">${esc(msg)}</div></div>`;
    }

    // ── Main render ───────────────────────────────────────────────────────────

    _render() {
      const tabs = [
        { id: 'lager',    label: '📦 Lager' },
        { id: 'shopping', label: '🛒 Indkøb' },
        { id: 'catalog',  label: '📋 Katalog' },
        { id: 'settings', label: '⚙️ Indstillinger' },
      ];

      const nav = tabs.map(t =>
        `<button class="nav-btn${this._tab === t.id ? ' active' : ''}" data-tab="${t.id}">${t.label}</button>`
      ).join('');

      let content = '';
      if      (this._tab === 'lager')    content = this._htmlLager();
      else if (this._tab === 'shopping') content = this._htmlShopping();
      else if (this._tab === 'catalog')  content = this._htmlCatalog();
      else                               content = this._htmlSettings();

      const globalErr = this._errors.global
        ? `<div class="error-banner">${esc(this._errors.global)}</div>` : '';

      const drawer   = this._drawerItem ? this._htmlDrawer()   : '';
      const addModal = this._addModal   ? this._htmlAddModal() : '';

      this.shadowRoot.innerHTML = `
        <style>${this._css()}</style>
        <div class="panel">
          <nav class="nav">${nav}</nav>
          ${globalErr}
          ${content}
        </div>
        ${drawer}
        ${addModal}`;

      this._attachListeners();
    }

    // ── Lager tab ─────────────────────────────────────────────────────────────

    _htmlLager() {
      // Category filter tabs (by list_type, matching app behaviour)
      const catBtns = [
        { key: 'all',     label: 'Alle' },
        { key: 'freezer', label: `${CATEGORY_ICONS.freezer} Fryser` },
        { key: 'fridge',  label: `${CATEGORY_ICONS.fridge} Køleskab` },
        { key: 'pantry',  label: `${CATEGORY_ICONS.pantry} Kolonial` },
      ].map(c =>
        `<button class="f-btn${this._filterUnit === c.key ? ' active' : ''}" data-unit="${c.key}">${c.label}</button>`
      ).join('');

      const q = this._searchLager.toLowerCase();

      // Units visible in the current category filter
      const visibleUnits = this._filterUnit === 'all'
        ? this._storageUnits
        : this._storageUnits.filter(u => u.list_type === this._filterUnit);

      const itemRow = (item) => {
        const name = item.name || item.product_name || item.custom_name || 'Ukendt';
        const subParts = [
          item.brand || null,
          item.weight_per_unit ? `${item.weight_per_unit}${item.unit && item.unit !== 'stk' ? item.unit : 'g'}` : null,
          (item.location_name || this._locations.find(l => l.id === item.location_id)?.name)
            ? `📍 ${item.location_name || this._locations.find(l => l.id === item.location_id)?.name}` : null,
        ].filter(Boolean);
        const sub = subParts.length ? `<div class="sub">${esc(subParts.join(' · '))}</div>` : '';
        return `<div class="row clickable" data-inv-id="${esc(item.id)}">
          <div class="info"><div class="name">${esc(name)}</div>${sub}</div>
          <span class="badge badge-grey">${item.quantity ?? 0} stk</span>
          ${expiryBadge(item.expiry_date)}
          <span class="chevron">›</span>
        </div>`;
      };

      // Pre-group items: by storage_unit_id if set, else by list_type to first unit of that type
      const unitByType = new Map();
      this._storageUnits.forEach(u => { if (!unitByType.has(u.list_type)) unitByType.set(u.list_type, u); });
      const itemsByUnit = new Map();
      this._storageUnits.forEach(u => itemsByUnit.set(u.id, []));
      this._inventory.forEach(item => {
        if (item.storage_unit_id && itemsByUnit.has(item.storage_unit_id)) {
          itemsByUnit.get(item.storage_unit_id).push(item);
        } else if (item.list_type) {
          const fallback = unitByType.get(item.list_type);
          if (fallback) itemsByUnit.get(fallback.id).push(item);
        }
      });

      let anyItems = false;
      const sections = visibleUnits.map(unit => {
        const unitLocs = this._locations.filter(l => l.storage_unit_id === unit.id);
        const allUnitItems = itemsByUnit.get(unit.id) || [];
        const unitItems = allUnitItems.filter(i =>
          !q || (i.name || '').toLowerCase().includes(q)
        );
        if (unitItems.length === 0) return '';
        anyItems = true;

        const knownLocIds = new Set(unitLocs.map(l => l.id));
        const byLoc = unitLocs
          .map(loc => ({ loc, items: unitItems.filter(i => i.location_id === loc.id) }))
          .filter(g => g.items.length > 0);
        const noLoc = unitItems.filter(i => !i.location_id || !knownLocIds.has(i.location_id));

        const locSections = [
          ...byLoc.map(({ loc, items: li }) =>
            `<div class="loc-hdr">${esc(loc.name)}</div>${li.map(itemRow).join('')}`
          ),
          noLoc.length > 0
            ? `${byLoc.length > 0 ? '<div class="loc-hdr">Ingen placering</div>' : ''}${noLoc.map(itemRow).join('')}`
            : '',
        ].join('');

        return `<div class="unit-section">
          <div class="unit-hdr"><span>${CATEGORY_ICONS[unit.list_type] || '📦'} ${esc(unit.name)}</span></div>
          ${locSections}
        </div>`;
      }).join('');

      return `
        <div class="card">
          <div class="card-hdr">Lager
            <button class="btn btn-primary" id="lager-add-btn" style="padding:6px 14px;font-size:13px">+ Tilføj vare</button>
          </div>
          <div class="srch"><input class="srch-input" id="lager-search" placeholder="Søg lagervare…" value="${esc(this._searchLager)}"/></div>
          <div class="filters">${catBtns}</div>
          <div class="list">${anyItems ? sections : '<div class="empty">Ingen varer fundet</div>'}</div>
        </div>`;
    }

    // ── Shopping tab ──────────────────────────────────────────────────────────

    _htmlShopping() {
      const unchecked = this._shopping.filter(i => !i.checked);
      const q = this._searchShop.toLowerCase();
      const filtered = unchecked.filter(i => {
        const n = (i.product_name || i.custom_name || '').toLowerCase();
        return !q || n.includes(q);
      });

      const hasChecked = this._shopping.some(i => i.checked);
      const editId = this._editShopId;

      const rows = filtered.map(i => {
        const name = i.product_name || i.custom_name || 'Ukendt';
        if (editId === i.id) {
          return `<div class="shop-row" style="flex-wrap:wrap;gap:6px;padding:8px 8px">
            <div class="check-circle" style="opacity:.3;cursor:default">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <circle cx="6" cy="6" r="5" stroke="#ccc" stroke-width="1.5"/>
              </svg>
            </div>
            <div class="info"><div class="name">${esc(name)}</div></div>
            <input class="inp add-qty" id="shop-edit-qty" type="number" min="1" value="${i.quantity ?? 1}" style="width:64px"/>
            <input class="inp add-unit" id="shop-edit-unit" value="${esc(i.unit || 'stk')}" style="width:72px"/>
            <button class="btn btn-primary" data-save-shop="${esc(i.id)}" style="padding:8px 12px">✓</button>
            <button class="btn btn-ghost" id="shop-edit-cancel" style="padding:8px 12px">✕</button>
          </div>`;
        }
        return `<div class="shop-row">
          <div class="check-circle" data-check-id="${esc(i.id)}" title="Markér som fundet">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="5" stroke="#ccc" stroke-width="1.5"/>
            </svg>
          </div>
          <div class="info" style="cursor:pointer" data-edit-shop="${esc(i.id)}"><div class="name">${esc(name)}</div></div>
          <span class="badge badge-grey" style="cursor:pointer" data-edit-shop="${esc(i.id)}">${i.quantity ?? 1} ${esc(i.unit || 'stk')}</span>
          <button class="del-btn" data-del-shop="${esc(i.id)}" title="Slet">✕</button>
        </div>`;
      }).join('');

      return `
        <div class="card">
          <div class="srch"><input class="srch-input" id="shop-search" placeholder="Søg på listen…" value="${esc(this._searchShop)}"/></div>
          <div class="list">${rows || '<div class="empty">Ingen varer på listen 🎉</div>'}</div>
          <div class="add-form">
            <input class="inp add-name" id="shop-add-name" placeholder="Tilføj vare…"/>
            <input class="inp add-qty"  id="shop-add-qty"  type="number" min="1" value="1"/>
            <input class="inp add-unit" id="shop-add-unit" value="stk"/>
            <button class="btn btn-primary" id="shop-add-btn">+</button>
          </div>
          ${hasChecked ? `<div style="padding:0 16px 12px"><button class="btn btn-ghost" id="shop-clear-checked" style="font-size:13px">Ryd checkede varer</button></div>` : ''}
        </div>`;
    }

    // ── Catalog tab ───────────────────────────────────────────────────────────

    _htmlCatalog() {
      const catBtns = [
        `<button class="f-btn${this._filterCat === 'all' ? ' active' : ''}" data-cat="all">Alle</button>`,
        ...Object.entries(CATEGORY_LABELS).map(([k, v]) =>
          `<button class="f-btn${this._filterCat === k ? ' active' : ''}" data-cat="${k}">${CATEGORY_ICONS[k]} ${v}</button>`
        ),
      ].join('');

      const q = this._searchCat.toLowerCase();
      const filtered = this._catalog.filter(p => {
        const matchCat = this._filterCat === 'all' || p.category === this._filterCat;
        const n = (p.name || '').toLowerCase();
        const b = (p.brand || '').toLowerCase();
        return matchCat && (!q || n.includes(q) || b.includes(q));
      });

      const rows = filtered.map(p => {
        const stock = p.in_stock ?? 0;
        const stockBadge = stock > 0
          ? `<span class="badge badge-ok">${stock} stk</span>`
          : `<span class="badge badge-grey">Ikke på lager</span>`;
        return `<div class="row clickable" data-cat-id="${esc(p.id)}">
          <span style="font-size:18px;width:28px;text-align:center;flex-shrink:0">${CATEGORY_ICONS[p.category] || '📦'}</span>
          <div class="info">
            <div class="name">${esc(p.name || 'Ukendt')}</div>
            ${p.brand ? `<div class="sub">${esc(p.brand)}</div>` : ''}
          </div>
          ${stockBadge}
          <span class="chevron">›</span>
        </div>`;
      }).join('');

      return `
        <div class="card">
          <div class="srch"><input class="srch-input" id="cat-search" placeholder="Søg katalog…" value="${esc(this._searchCat)}"/></div>
          <div class="filters">${catBtns}</div>
          <div class="list">${rows || '<div class="empty">Ingen produkter fundet</div>'}</div>
        </div>`;
    }

    // ── Settings tab ──────────────────────────────────────────────────────────

    _htmlSettings() {
      const err = this._errors.settings
        ? `<div class="error-banner">${esc(this._errors.settings)}</div>` : '';

      if (!this._household) {
        return `${err}<div class="card"><div class="empty">Indlæser indstillinger…</div></div>`;
      }

      const hh   = this._household || {};
      const prof  = this._profile   || {};
      const prefs = this._preferences || { filters: [] };
      const isPrem = this._isPremium;

      // Household
      const hhHtml = `
        <div class="card">
          <div class="card-hdr">Husstand</div>
          <div class="card-body">
            <div class="frow"><label class="lbl">Husstand-navn</label>
              <input class="inp" id="hh-name" value="${esc(hh.name || '')}"/></div>
            <div class="frow"><label class="lbl">Husstand-ID</label>
              <input class="inp" value="${esc(hh.id || this._config.household_id)}" readonly style="color:#aaa"/></div>
            <div class="frow"><label class="lbl">Invitationskode</label>
              <input class="inp" value="${esc(hh.invitation_code || hh.invite_code || '—')}" readonly style="color:#aaa" id="hh-code-input"/></div>
            <div style="display:flex;gap:8px;margin-top:4px">
              <button class="btn btn-primary" id="hh-save">Gem navn</button>
              <button class="btn btn-ghost"   id="hh-regen">Ny invitationskode</button>
            </div>
          </div>
        </div>`;

      // Storage units + shelves combined (nested, matching app structure)
      const premLockUnit = isPrem === false
        ? `<div class="lock-row">🔒 Premium kræves for at oprette ekstra lagerenheder på Kitchey cloud. Opgrader i Kitchey-appen.</div>`
        : '';
      const premLockShelf = isPrem === false
        ? `<div class="lock-row" style="margin-top:6px">🔒 Premium kræves for at oprette ekstra hylder.</div>`
        : '';

      const unitSections = this._storageUnits.map(u => {
        const shelves = this._locations.filter(l => l.storage_unit_id === u.id);
        const shelfRows = shelves.map(l =>
          `<div class="unit-row" style="padding-left:12px">
            <div class="unit-name" style="font-size:13px">📌 ${esc(l.name)}</div>
            <button class="del-btn" data-del-shelf="${esc(l.id)}" title="Slet hylde">🗑</button>
          </div>`
        ).join('');

        const addShelfForm = isPrem ? `
          <div style="display:flex;gap:6px;padding:6px 0 2px 12px">
            <input class="inp" data-new-shelf-for="${esc(u.id)}" placeholder="Ny hylde…" style="flex:1;font-size:13px;padding:7px 10px"/>
            <button class="btn btn-primary" data-add-shelf-for="${esc(u.id)}" style="padding:7px 12px;font-size:13px">+</button>
          </div>` : premLockShelf;

        return `
          <div style="border-bottom:1px solid #f0f0f0;padding:10px 0 8px">
            <div style="display:flex;align-items:center;gap:8px;padding:0 4px 6px">
              <span style="font-size:16px">${CATEGORY_ICONS[u.list_type] || '📦'}</span>
              <div style="flex:1">
                <div class="unit-name">${esc(u.name)}</div>
                <div class="unit-type">${CATEGORY_LABELS[u.list_type] || ''}</div>
              </div>
              <button class="del-btn" data-del-unit="${esc(u.id)}" title="Slet enhed">🗑</button>
            </div>
            ${shelfRows}
            ${addShelfForm}
          </div>`;
      }).join('');

      const newUnitForm = isPrem ? `
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <input class="inp" id="new-unit-name" placeholder="Navn på ny enhed" style="flex:1;min-width:120px"/>
          <select class="inp" id="new-unit-type" style="width:120px">
            <option value="fridge">Køleskab</option>
            <option value="freezer">Fryser</option>
            <option value="pantry">Kolonial</option>
          </select>
          <button class="btn btn-primary" id="create-unit-btn">Opret</button>
        </div>` : premLockUnit;

      const unitsHtml = `
        <div class="card">
          <div class="card-hdr">Lagerenheder & Hylder</div>
          <div class="card-body">
            ${unitSections || '<div class="empty" style="padding:8px 0">Ingen lagerenheder</div>'}
            ${newUnitForm}
          </div>
        </div>`;

      // Dietary preferences
      const activeFilters = prefs.filters || [];
      const prefRows = DIET_OPTIONS.map(opt => `
        <div class="toggle-row">
          <span class="toggle-lbl">${opt.label}</span>
          <label class="toggle">
            <input type="checkbox" data-pref="${opt.key}" ${activeFilters.includes(opt.key) ? 'checked' : ''}/>
            <span class="toggle-track"></span>
          </label>
        </div>`).join('');

      const prefHtml = `
        <div class="card">
          <div class="card-hdr">Kostvanepræferencer</div>
          <div class="card-body">${prefRows}</div>
        </div>`;

      // Profile
      const profileHtml = `
        <div class="card">
          <div class="card-hdr">Profil</div>
          <div class="card-body" style="display:flex;flex-direction:column;gap:12px">
            <div class="frow"><label class="lbl">E-mail</label>
              <input class="inp" value="${esc(prof.email || '')}" readonly style="color:#aaa"/></div>
            <div class="frow"><label class="lbl">Visningsnavn</label>
              <input class="inp" id="prof-name" value="${esc(prof.display_name || prof.name || '')}"/></div>
            <div><button class="btn btn-primary" id="prof-save">Gem profil</button></div>
          </div>
        </div>`;

      return `${err}${hhHtml}${unitsHtml}${prefHtml}${profileHtml}`;
    }

    // ── Drawer (inventory item edit) ──────────────────────────────────────────

    _htmlDrawer() {
      const item   = this._drawerItem;
      const name   = item.name || item.product_name || item.custom_name || 'Ukendt';
      const brand  = item.brand ? `<div style="font-size:13px;color:#888;margin-top:2px">${esc(item.brand)}</div>` : '';
      const expiry = item.expiry_date ? item.expiry_date.slice(0, 10) : '';
      const opened = this._drawerOpened;
      const openedAt = this._drawerOpenedAt;
      const dateAdded = item.date_added ? new Date(item.date_added).toLocaleDateString('da-DK') : null;

      // Location options grouped by storage unit (matching item's list_type)
      const relevantUnits = this._storageUnits.filter(u => u.list_type === item.list_type);
      const locOptgroups = relevantUnits.map(unit => {
        const unitLocs = this._locations.filter(l => l.storage_unit_id === unit.id);
        if (!unitLocs.length) return '';
        return `<optgroup label="${esc(unit.name)}">${unitLocs.map(l =>
          `<option value="${esc(l.id)}" ${l.id === item.location_id ? 'selected' : ''}>${esc(l.name)}</option>`
        ).join('')}</optgroup>`;
      }).join('');
      const locOptions = `<option value="">Ingen placering</option>${locOptgroups}`;

      const drawerErr = this._errors.drawer
        ? `<div class="error-banner" style="margin-top:12px">${esc(this._errors.drawer)}</div>` : '';

      return `
        <div class="drawer-overlay" id="drawer-overlay">
          <div class="drawer">
            <div class="drawer-handle"></div>
            <div class="drawer-title">${esc(name)}${brand}</div>

            <div class="frow"><label class="lbl">Antal</label>
              <div class="stepper">
                <button class="step-btn" id="drawer-qty-minus">−</button>
                <input class="inp" id="drawer-qty" type="number" min="0" value="${item.quantity ?? 1}" style="text-align:center;flex:1"/>
                <button class="step-btn" id="drawer-qty-plus">+</button>
              </div>
            </div>

            <div class="frow"><label class="lbl">Placering (hylde)</label>
              <select class="inp" id="drawer-loc">${locOptions}</select></div>

            <div class="frow"><label class="lbl">Udløbsdato</label>
              <input class="inp" id="drawer-expiry" type="date" value="${esc(expiry)}"/></div>

            ${dateAdded ? `<div class="frow"><label class="lbl">Lagt ind</label>
              <input class="inp" value="${esc(dateAdded)}" readonly style="color:#aaa"/></div>` : ''}

            <div class="frow"><label class="lbl">Status</label>
              <button class="opened-btn${opened ? ' on' : ''}" id="drawer-opened">
                ${opened ? `🔓 Åben${openedAt ? ` siden ${openedAt}` : ''}` : '🔒 Ikke åbnet — klik for at markere som åben'}
              </button>
            </div>

            ${opened ? `<div class="frow"><label class="lbl">Åbnet dato</label>
              <input class="inp" id="drawer-opened-at" type="date" value="${esc(openedAt)}"/></div>` : ''}

            <div class="frow"><label class="lbl">Noter</label>
              <input class="inp" id="drawer-notes" placeholder="fx Købt i Netto" value="${esc(item.notes || '')}"/></div>

            <div class="drawer-actions">
              <button class="btn btn-primary" id="drawer-save">Gem</button>
              <button class="btn btn-danger"  id="drawer-use">Brug 1</button>
              <button class="btn" style="background:#fff;color:#f44336;border:1px solid #f44336" id="drawer-delete">Slet</button>
              <button class="btn btn-ghost"   id="drawer-close">Luk</button>
            </div>
            ${drawerErr}
          </div>
        </div>`;
    }

    // ── Add-to-inventory modal (3 steps) ─────────────────────────────────────

    _htmlAddModal() {
      const m    = this._addModal;
      const step = m.step;
      const f    = m.form;
      const q    = (m.search || '').toLowerCase();

      const titles = { search: 'Tilføj vare', new: 'Nyt produkt', confirm: 'Tilføj til lager' };
      const backBtn = step !== 'search'
        ? `<button class="btn btn-ghost" id="modal-back" style="padding:6px 10px;font-size:13px">← Tilbage</button>` : '';
      const errBanner = m.error
        ? `<div class="error-banner">${esc(m.error)}</div>` : '';

      let body = '';

      // ── Step: search ────────────────────────────────────────────────────────
      if (step === 'search') {
        const filtered = this._catalog.filter(p => {
          const n = (p.name || '').toLowerCase();
          const b = (p.brand || '').toLowerCase();
          const bc = (p.barcode || '').toLowerCase();
          return !q || n.includes(q) || b.includes(q) || bc.includes(q);
        }).slice(0, 40);

        const catRows = filtered.map(p => {
          const wgt = p.weight_per_unit ? ` · ${p.weight_per_unit}${p.unit && p.unit !== 'stk' ? p.unit : 'g'}` : '';
          const sub2 = [p.brand, wgt ? wgt.slice(3) : null].filter(Boolean).join(' · ');
          const stock = p.in_stock > 0 ? `<span class="badge badge-ok" style="flex-shrink:0">${p.in_stock} stk</span>` : '';
          return `<div class="cat-row" data-modal-pick="${esc(p.id)}">
            <div class="cat-thumb">${p.thumbnail ? `<img src="${esc(p.thumbnail)}" alt=""/>` : (CATEGORY_ICONS[p.category] || '📦')}</div>
            <div class="info"><div class="name" style="font-size:14px">${esc(p.name)}</div>${sub2 ? `<div class="sub">${esc(sub2)}</div>` : ''}</div>
            ${stock}
          </div>`;
        }).join('');

        const newBtn = q
          ? `<button class="btn btn-ghost" id="modal-create-new" style="width:100%;justify-content:center">+ Opret "${esc(q)}" som nyt produkt</button>` : '';

        body = `
          <button class="btn btn-primary" id="modal-scan-barcode" style="width:100%;justify-content:center">📷 Scan stregkode</button>
          <input class="srch-input" id="modal-search" placeholder="Søg produktnavn eller stregkode…" value="${esc(m.search || '')}"/>
          ${newBtn}
          <div style="display:flex;flex-direction:column;gap:6px">${catRows || (q ? '<div class="empty">Ingen produkter fundet</div>' : '')}</div>`;
      }

      // ── Step: new product ───────────────────────────────────────────────────
      if (step === 'new') {
        const unitOpts = ['stk','g','kg','ml','l','pk','bk','pose','bakke','flaske','dåse']
          .map(u => `<option value="${u}" ${f.unit === u ? 'selected' : ''}>${u}</option>`).join('');
        body = `
          <div class="frow"><label class="lbl">Navn *</label>
            <input class="inp" id="modal-name" placeholder="fx Hakket oksekød" value="${esc(f.name)}"/></div>
          <div class="frow"><label class="lbl">Mærke</label>
            <input class="inp" id="modal-brand" placeholder="fx Netto" value="${esc(f.brand)}"/></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div class="frow"><label class="lbl">Enhed</label>
              <select class="inp" id="modal-unit">${unitOpts}</select></div>
            <div class="frow"><label class="lbl">Størrelse</label>
              <input class="inp" id="modal-wpu" type="number" placeholder="fx 500" value="${esc(f.weight_per_unit)}"/></div>
          </div>
          <div class="frow"><label class="lbl">Stregkode</label>
            <input class="inp" id="modal-barcode" placeholder="EAN / stregkode" value="${esc(f.barcode)}"/></div>
          ${errBanner}
          <button class="btn btn-primary" id="modal-to-confirm" style="width:100%;justify-content:center" ${f.name ? '' : 'disabled'}>Fortsæt →</button>`;
      }

      // ── Step: confirm ───────────────────────────────────────────────────────
      if (step === 'confirm') {
        // Location optgroups grouped by unit
        const locOptgroups = this._storageUnits.map(unit => {
          const unitLocs = this._locations.filter(l => l.storage_unit_id === unit.id);
          if (!unitLocs.length) return '';
          return `<optgroup label="${esc(unit.name)} (${CATEGORY_LABELS[unit.list_type] || unit.list_type})">${
            unitLocs.map(l => `<option value="${esc(l.id)}" ${l.id === f.location_id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')
          }</optgroup>`;
        }).join('');
        const locOptions = `<option value="">Ingen placering</option>${locOptgroups}`;

        const productCard = `<div style="background:${BG};border-radius:8px;padding:10px 12px">
          <div style="font-weight:600;font-size:14px">${esc(f.name)}</div>
          ${f.brand ? `<div style="font-size:12px;color:#888">${esc(f.brand)}</div>` : ''}
        </div>`;

        body = `
          ${productCard}
          <div class="frow"><label class="lbl">Antal</label>
            <div class="stepper">
              <button class="step-btn" id="modal-qty-minus">−</button>
              <input class="inp" id="modal-qty" type="number" min="1" value="${f.quantity}" style="text-align:center;flex:1"/>
              <button class="step-btn" id="modal-qty-plus">+</button>
            </div>
          </div>
          <div class="frow"><label class="lbl">Placering</label>
            <select class="inp" id="modal-loc">${locOptions}</select></div>
          <div class="frow"><label class="lbl">Udløbsdato</label>
            <input class="inp" id="modal-expiry" type="date" value="${esc(f.expiry_date)}"/></div>
          <div class="frow"><label class="lbl">Dato lagt ind</label>
            <input class="inp" id="modal-date-added" type="date" value="${esc(f.date_added)}"/></div>
          <div class="frow"><label class="lbl">Status</label>
            <button class="opened-btn${f.opened ? ' on' : ''}" id="modal-opened">
              ${f.opened ? '🔓 Åben' : '🔒 Ikke åbnet'}
            </button>
          </div>
          ${f.opened ? `<div class="frow"><label class="lbl">Åbnet dato</label>
            <input class="inp" id="modal-opened-at" type="date" value="${esc(f.opened_at || f.date_added)}"/></div>` : ''}
          <div class="frow"><label class="lbl">Noter</label>
            <input class="inp" id="modal-notes" placeholder="fx Købt i Netto" value="${esc(f.notes)}"/></div>
          ${errBanner}
          <button class="btn btn-primary" id="modal-save" style="width:100%;justify-content:center" ${m.saving ? 'disabled' : ''}>
            ${m.saving ? '⏳ Gemmer…' : '✓ Tilføj til lager'}
          </button>`;
      }

      return `
        <div class="modal-overlay" id="modal-overlay">
          <div class="modal-sheet">
            <div class="modal-handle"></div>
            <div class="modal-hdr">
              <div style="display:flex;align-items:center;gap:8px">${backBtn}<span class="modal-title">${titles[step]}</span></div>
              <button class="btn btn-ghost" id="modal-close" style="padding:6px 10px;font-size:18px">×</button>
            </div>
            <div class="modal-body">${body}</div>
          </div>
        </div>`;
    }

    // ── Event listeners ───────────────────────────────────────────────────────

    _attachListeners() {
      const root = this.shadowRoot;

      // ── Navigation
      root.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          this._tab = btn.dataset.tab;
          if (this._tab === 'settings' && !this._household) {
            await Promise.all([this._fetchSettings(), this._checkPremium()]);
          }
          this._render();
        });
      });

      // ── Lager
      root.querySelector('#lager-add-btn')?.addEventListener('click', () => {
        this._openAddModal('search');
      });
      root.querySelector('#lager-search')?.addEventListener('input', e => {
        this._searchLager = e.target.value;
        this._render();
      });
      root.querySelectorAll('[data-unit]').forEach(btn =>
        btn.addEventListener('click', () => { this._filterUnit = btn.dataset.unit; this._render(); })
      );
      root.querySelectorAll('[data-inv-id]').forEach(row =>
        row.addEventListener('click', () => {
          const item = this._inventory.find(i => i.id === row.dataset.invId) || null;
          this._drawerItem   = item;
          this._drawerOpened = !!(item?.opened);
          this._drawerOpenedAt = item?.opened_at ? item.opened_at.slice(0, 10) : '';
          delete this._errors.drawer;
          this._render();
        })
      );

      // ── Drawer
      root.querySelector('#drawer-overlay')?.addEventListener('click', e => {
        if (e.target.id === 'drawer-overlay') { this._drawerItem = null; this._render(); }
      });
      root.querySelector('#drawer-close')?.addEventListener('click', () => {
        this._drawerItem = null; this._render();
      });
      root.querySelector('#drawer-qty-minus')?.addEventListener('click', () => {
        const inp = root.querySelector('#drawer-qty');
        if (inp) inp.value = Math.max(0, (parseInt(inp.value) || 0) - 1);
      });
      root.querySelector('#drawer-qty-plus')?.addEventListener('click', () => {
        const inp = root.querySelector('#drawer-qty');
        if (inp) inp.value = (parseInt(inp.value) || 0) + 1;
      });
      root.querySelector('#drawer-opened')?.addEventListener('click', () => {
        const item = this._drawerItem;
        this._drawerOpened = !this._drawerOpened;
        if (this._drawerOpened && !this._drawerOpenedAt)
          this._drawerOpenedAt = new Date().toISOString().slice(0, 10);
        if (!this._drawerOpened) this._drawerOpenedAt = '';
        this._render();
      });
      root.querySelector('#drawer-save')?.addEventListener('click', async () => {
        const item      = this._drawerItem;
        const qty       = parseInt(root.querySelector('#drawer-qty')?.value) || 0;
        const expiry    = root.querySelector('#drawer-expiry')?.value || null;
        const locId     = root.querySelector('#drawer-loc')?.value || null;
        const notes     = root.querySelector('#drawer-notes')?.value || null;
        const openedAt  = root.querySelector('#drawer-opened-at')?.value || null;
        try {
          await this._api('PUT', `/api/inventory/${item.id}`, {
            quantity:    qty,
            expiry_date: expiry || null,
            location_id: locId || null,
            notes:       notes || null,
            opened:      this._drawerOpened ? 1 : 0,
            opened_at:   this._drawerOpened ? (openedAt || this._drawerOpenedAt || null) : null,
          });
          this._drawerItem = null;
          await this._fetchAll();
          this._render();
        } catch (e) { this._errors.drawer = e.message; this._render(); }
      });
      root.querySelector('#drawer-use')?.addEventListener('click', async () => {
        const item = this._drawerItem;
        try {
          await this._api('POST', `/api/inventory/${item.id}/use`, { amount: 1 });
          this._drawerItem = null;
          await this._fetchAll();
          this._render();
        } catch (e) { this._errors.drawer = e.message; this._render(); }
      });
      root.querySelector('#drawer-delete')?.addEventListener('click', async () => {
        const item = this._drawerItem;
        if (!confirm(`Slet "${item.name || 'vare'}" fra lager?`)) return;
        try {
          await this._api('DELETE', `/api/inventory/${item.id}`);
          this._drawerItem = null;
          await this._fetchAll();
          this._render();
        } catch (e) { this._errors.drawer = e.message; this._render(); }
      });

      // ── Shopping
      root.querySelector('#shop-search')?.addEventListener('input', e => {
        this._searchShop = e.target.value; this._render();
      });
      root.querySelectorAll('[data-edit-shop]').forEach(el =>
        el.addEventListener('click', () => {
          this._editShopId = el.dataset.editShop;
          this._render();
        })
      );
      root.querySelector('#shop-edit-cancel')?.addEventListener('click', () => {
        this._editShopId = null; this._render();
      });
      root.querySelectorAll('[data-save-shop]').forEach(btn =>
        btn.addEventListener('click', async () => {
          const id  = btn.dataset.saveShop;
          const qty = parseInt(root.querySelector('#shop-edit-qty')?.value) || 1;
          const unit = root.querySelector('#shop-edit-unit')?.value.trim() || 'stk';
          try {
            await this._api('PUT', `/api/shopping/${id}`, { quantity: qty, unit });
            this._editShopId = null;
            await this._fetchAll(); this._render();
          } catch (e) { this._errors.global = e.message; this._render(); }
        })
      );
      root.querySelectorAll('[data-check-id]').forEach(btn =>
        btn.addEventListener('click', async () => {
          try {
            await this._api('PUT', `/api/shopping/${btn.dataset.checkId}`, { checked: true, checked_by: 'HA Panel' });
            await this._fetchAll(); this._render();
          } catch (e) { this._errors.global = e.message; this._render(); }
        })
      );
      root.querySelectorAll('[data-del-shop]').forEach(btn =>
        btn.addEventListener('click', async ev => {
          ev.stopPropagation();
          try {
            await this._api('DELETE', `/api/shopping/${btn.dataset.delShop}`);
            await this._fetchAll(); this._render();
          } catch (e) { this._errors.global = e.message; this._render(); }
        })
      );
      const addShop = async () => {
        const name = root.querySelector('#shop-add-name')?.value.trim();
        if (!name) return;
        const qty  = parseInt(root.querySelector('#shop-add-qty')?.value)   || 1;
        const unit = root.querySelector('#shop-add-unit')?.value.trim()     || 'stk';
        try {
          await this._api('POST', '/api/shopping', { custom_name: name, quantity: qty, unit });
          root.querySelector('#shop-add-name').value = '';
          await this._fetchAll(); this._render();
        } catch (e) { this._errors.global = e.message; this._render(); }
      };
      root.querySelector('#shop-add-btn')?.addEventListener('click', addShop);
      root.querySelector('#shop-add-name')?.addEventListener('keydown', e => { if (e.key === 'Enter') addShop(); });
      root.querySelector('#shop-clear-checked')?.addEventListener('click', async () => {
        try {
          await this._api('DELETE', '/api/shopping/checked');
          await this._fetchAll(); this._render();
        } catch (e) { this._errors.global = e.message; this._render(); }
      });

      // ── Catalog
      root.querySelector('#cat-search')?.addEventListener('input', e => {
        this._searchCat = e.target.value; this._render();
      });
      root.querySelectorAll('[data-cat]').forEach(btn =>
        btn.addEventListener('click', () => { this._filterCat = btn.dataset.cat; this._render(); })
      );
      root.querySelectorAll('[data-cat-id]').forEach(row =>
        row.addEventListener('click', () => {
          const p = this._catalog.find(p => p.id === row.dataset.catId);
          if (p) this._openAddModal('confirm', this._formFromProduct(p));
        })
      );

      // ── Settings
      root.querySelector('#hh-save')?.addEventListener('click', async () => {
        const name = root.querySelector('#hh-name')?.value.trim();
        if (!name) return;
        try {
          await this._api('PATCH', `/api/households/${this._config.household_id}`, { name });
          await this._fetchSettings(); this._render();
        } catch (e) { this._errors.settings = e.message; this._render(); }
      });
      root.querySelector('#hh-regen')?.addEventListener('click', async () => {
        if (!confirm('Generer ny invitationskode? Den nuværende kode vil holde op med at virke.')) return;
        try {
          const r = await this._api('POST', `/api/households/${this._config.household_id}/regenerate-code`);
          if (r?.invitation_code || r?.invite_code) {
            const inp = root.querySelector('#hh-code-input');
            if (inp) inp.value = r.invitation_code || r.invite_code;
          }
          await this._fetchSettings(); this._render();
        } catch (e) { this._errors.settings = e.message; this._render(); }
      });
      root.querySelector('#create-unit-btn')?.addEventListener('click', async () => {
        const name = root.querySelector('#new-unit-name')?.value.trim();
        const type = root.querySelector('#new-unit-type')?.value;
        if (!name) return;
        try {
          await this._api('POST', '/api/storage-units', { name, list_type: type });
          await this._fetchAll(); this._render();
        } catch (e) { this._errors.settings = e.message; this._render(); }
      });
      root.querySelectorAll('[data-del-unit]').forEach(btn =>
        btn.addEventListener('click', async () => {
          if (!confirm(`Slet lagerenhed?`)) return;
          try {
            await this._api('DELETE', `/api/storage-units/${btn.dataset.delUnit}`);
            await this._fetchAll(); this._render();
          } catch (e) { this._errors.settings = e.message; this._render(); }
        })
      );
      root.querySelectorAll('[data-add-shelf-for]').forEach(btn =>
        btn.addEventListener('click', async () => {
          const unitId = btn.dataset.addShelfFor;
          const inp = root.querySelector(`[data-new-shelf-for="${unitId}"]`);
          const name = inp?.value.trim();
          if (!name || !unitId) return;
          try {
            await this._api('POST', '/api/locations', { name, storage_unit_id: unitId });
            if (inp) inp.value = '';
            await this._fetchAll(); this._render();
          } catch (e) { this._errors.settings = e.message; this._render(); }
        })
      );
      root.querySelectorAll('[data-del-shelf]').forEach(btn =>
        btn.addEventListener('click', async () => {
          if (!confirm('Slet hylde?')) return;
          try {
            await this._api('DELETE', `/api/locations/${btn.dataset.delShelf}`);
            await this._fetchAll(); this._render();
          } catch (e) { this._errors.settings = e.message; this._render(); }
        })
      );
      root.querySelectorAll('[data-pref]').forEach(toggle =>
        toggle.addEventListener('change', async () => {
          const key     = toggle.dataset.pref;
          let filters   = [...(this._preferences.filters || [])];
          if (toggle.checked) { if (!filters.includes(key)) filters.push(key); }
          else { filters = filters.filter(f => f !== key); }
          try {
            const updated = await this._api('PUT', '/api/preferences', { filters }, true);
            this._preferences = updated || { filters };
          } catch (e) { this._errors.settings = e.message; this._render(); }
        })
      );
      root.querySelector('#prof-save')?.addEventListener('click', async () => {
        const name = root.querySelector('#prof-name')?.value.trim();
        if (!name) return;
        try {
          await this._api('PATCH', '/api/auth/me', { display_name: name }, true);
          await this._fetchSettings(); this._render();
        } catch (e) { this._errors.settings = e.message; this._render(); }
      });

      // ── Add modal
      root.querySelector('#modal-overlay')?.addEventListener('click', e => {
        if (e.target.id === 'modal-overlay') { this._addModal = null; this._render(); }
      });
      root.querySelector('#modal-close')?.addEventListener('click', () => {
        this._addModal = null; this._render();
      });
      root.querySelector('#modal-back')?.addEventListener('click', () => {
        const step = this._addModal?.step;
        this._addModal = { ...this._addModal, step: step === 'confirm' ? 'new' : 'search', error: null };
        this._render();
      });

      // Step: search
      root.querySelector('#modal-search')?.addEventListener('input', e => {
        this._addModal = { ...this._addModal, search: e.target.value };
        this._render();
      });
      root.querySelector('#modal-scan-barcode')?.addEventListener('click', () => {
        // Trigger barcode simulation prompt (HID scanner will trigger _onKeydown naturally)
        // For manual entry provide a prompt as fallback
        const code = prompt('Indtast stregkode manuelt (eller brug HID-scanner):');
        if (code && code.length >= 4) { this._addModal = null; this._handleBarcode(code.trim()); }
      });
      root.querySelector('#modal-create-new')?.addEventListener('click', () => {
        const q = this._addModal?.search || '';
        this._addModal = { ...this._addModal, step: 'new', form: { ...this._emptyForm(), name: q }, error: null };
        this._render();
      });
      root.querySelectorAll('[data-modal-pick]').forEach(el =>
        el.addEventListener('click', () => {
          const p = this._catalog.find(p => p.id === el.dataset.modalPick);
          if (p) {
            this._addModal = { ...this._addModal, step: 'confirm', form: this._formFromProduct(p), error: null };
            this._render();
          }
        })
      );

      // Step: new product
      root.querySelector('#modal-to-confirm')?.addEventListener('click', () => {
        const name = root.querySelector('#modal-name')?.value.trim();
        if (!name) return;
        this._addModal = {
          ...this._addModal,
          step: 'confirm',
          error: null,
          form: {
            ...this._addModal.form,
            name,
            brand:          root.querySelector('#modal-brand')?.value.trim() || '',
            unit:           root.querySelector('#modal-unit')?.value || 'stk',
            weight_per_unit: root.querySelector('#modal-wpu')?.value || '',
            barcode:        root.querySelector('#modal-barcode')?.value.trim() || '',
          },
        };
        this._render();
      });
      // Live-update name field validity so Fortsæt button enables
      root.querySelector('#modal-name')?.addEventListener('input', e => {
        const btn = root.querySelector('#modal-to-confirm');
        if (btn) btn.disabled = !e.target.value.trim();
      });

      // Step: confirm
      root.querySelector('#modal-qty-minus')?.addEventListener('click', () => {
        const inp = root.querySelector('#modal-qty');
        if (inp) { inp.value = Math.max(1, (parseInt(inp.value) || 1) - 1); }
      });
      root.querySelector('#modal-qty-plus')?.addEventListener('click', () => {
        const inp = root.querySelector('#modal-qty');
        if (inp) { inp.value = (parseInt(inp.value) || 1) + 1; }
      });
      root.querySelector('#modal-opened')?.addEventListener('click', () => {
        const f = this._addModal.form;
        const nowOpen = !f.opened;
        this._addModal = {
          ...this._addModal,
          form: { ...f, opened: nowOpen, opened_at: nowOpen ? (f.date_added || new Date().toISOString().slice(0, 10)) : '' },
        };
        this._render();
      });
      root.querySelector('#modal-save')?.addEventListener('click', async () => {
        const f    = this._addModal.form;
        const qty  = parseInt(root.querySelector('#modal-qty')?.value) || 1;
        const locId = root.querySelector('#modal-loc')?.value || null;
        const expiry = root.querySelector('#modal-expiry')?.value || null;
        const dateAdded = root.querySelector('#modal-date-added')?.value || null;
        const openedAt = root.querySelector('#modal-opened-at')?.value || null;
        const notes = root.querySelector('#modal-notes')?.value || null;

        this._addModal = { ...this._addModal, saving: true, error: null };
        this._render();
        try {
          let productId = f.product_id;
          if (!productId) {
            // Need to create catalog product first
            const newProd = await this._api('POST', '/api/catalog', {
              name:            f.name,
              brand:           f.brand || null,
              barcode:         f.barcode || null,
              category:        locId
                ? (this._storageUnits.find(u => this._locations.find(l => l.id === locId && l.storage_unit_id === u.id))?.list_type || f.category)
                : f.category,
              unit:            f.unit || 'stk',
              weight_per_unit: f.weight_per_unit ? parseFloat(f.weight_per_unit) : null,
            });
            productId = newProd.id;
          }
          // Determine list_type from selected location → unit, else product category
          const selectedUnit = locId
            ? this._storageUnits.find(u => this._locations.find(l => l.id === locId && l.storage_unit_id === u.id))
            : null;
          const listType = selectedUnit?.list_type || f.category || 'pantry';

          await this._api('POST', '/api/inventory', {
            product_id:  productId,
            quantity:    qty,
            list_type:   listType,
            location_id: locId || null,
            expiry_date: expiry || null,
            date_added:  dateAdded || null,
            notes:       notes || null,
            opened:      f.opened ? 1 : 0,
            opened_at:   f.opened ? (openedAt || null) : null,
          });
          this._addModal = null;
          await this._fetchAll();
          this._render();
        } catch (e) {
          this._addModal = { ...this._addModal, saving: false, error: e.message };
          this._render();
        }
      });
    }

  }

  if (!customElements.get('kitchey-panel')) {
    customElements.define('kitchey-panel', KitcheyPanel);
  }
})();
