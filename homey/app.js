'use strict';

const Homey = require('homey');
const KitcheyApi = require('./lib/KitcheyApi');
const {
  toDateKey, todayKey, daysUntil, shortDate, shoppingName, norm, computeStats,
} = require('./lib/util');

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const CONFIG_KEYS = ['server_url', 'token', 'household_id'];
const CATALOG_CACHE_MS = 60 * 1000;
const EXPIRY_LOOKAHEAD_DAYS = 30;
const ALL_UNITS = '*';

class KitcheyApp extends Homey.App {
  async onInit() {
    this.log('Kitchey starting...');
    this.api = null;
    this.snapshot = null; // latest data; see _buildSnapshot()
    this.lastError = null;
    this._pollTimer = null;
    this._reinitTimer = null;
    this._polling = null;
    this._catalogCache = { at: 0, items: [] };
    this._lastShoppingEmitted = null;

    this._registerFlowCards();

    this.homey.settings.on('set', (key) => {
      if (CONFIG_KEYS.includes(key)) this._scheduleReinit();
    });
    await this._reinit();
    this.log('Kitchey ready');
  }

  async onUninit() {
    this._stopPolling();
    if (this._reinitTimer) this.homey.clearTimeout(this._reinitTimer);
  }

  // ── Configuration & polling ─────────────────────────────────────────────

  isConfigured() {
    return !!this.api;
  }

  _scheduleReinit() {
    // Saving the settings page writes three keys in a row; coalesce them.
    if (this._reinitTimer) this.homey.clearTimeout(this._reinitTimer);
    this._reinitTimer = this.homey.setTimeout(() => {
      this._reinitTimer = null;
      this._reinit().catch((err) => this.error('reinit failed:', err.message));
    }, 500);
  }

  async _reinit() {
    this._stopPolling();
    const serverUrl = this.homey.settings.get('server_url');
    const token = this.homey.settings.get('token');
    const householdId = this.homey.settings.get('household_id');
    if (!serverUrl || !token || !householdId) {
      this.api = null;
      this.snapshot = null;
      this._setDevicesUnavailable(this.homey.__('error.not_configured'));
      return;
    }
    this.api = new KitcheyApi({ serverUrl, token, householdId });
    this.snapshot = null; // new household/server → start a fresh baseline
    await this.poll();
    this._pollTimer = this.homey.setInterval(() => {
      this.poll().catch(() => {});
    }, POLL_INTERVAL_MS);
  }

  _stopPolling() {
    if (this._pollTimer) {
      this.homey.clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  /** Fetch everything, update devices and fire triggers. Concurrent calls share one run. */
  poll() {
    if (!this.api) return Promise.resolve();
    if (!this._polling) {
      this._polling = this._doPoll().finally(() => { this._polling = null; });
    }
    return this._polling;
  }

  async _doPoll() {
    try {
      const [inventory, shopping, units, locations] = await Promise.all([
        this.api.getInventory(),
        this.api.getShopping(),
        this.api.getStorageUnits(),
        this.api.getLocations(),
      ]);
      const prev = this.snapshot;
      const snapshot = this._buildSnapshot({ inventory, shopping, units, locations });
      this.snapshot = snapshot;
      this.lastError = null;

      await this._updateDevices(snapshot);
      this._setDevicesAvailable();
      this._emitShoppingRealtime(snapshot);

      if (prev) {
        this._detectInventoryChanges(prev, snapshot);
        this._detectShoppingChanges(prev, snapshot);
      }
      this._checkExpiry(snapshot);
    } catch (err) {
      this.lastError = err.message;
      this.error('Poll failed:', err.message);
      this._setDevicesUnavailable(err.message);
    }
  }

  _buildSnapshot({ inventory, shopping, units, locations }) {
    const today = todayKey(this.homey.clock.getTimezone());
    const unitById = new Map(units.map((u) => [u.id, u]));
    const unitByLocation = new Map();
    for (const loc of locations) {
      if (loc.storage_unit_id && unitById.has(loc.storage_unit_id)) {
        unitByLocation.set(loc.id, unitById.get(loc.storage_unit_id));
      }
    }
    const defaultUnitByListType = new Map();
    for (const u of [...units].sort((a, b) => (a.position || 0) - (b.position || 0))) {
      if (!defaultUnitByListType.has(u.list_type)) defaultUnitByListType.set(u.list_type, u);
    }

    const items = inventory.map((raw) => {
      const unit = unitByLocation.get(raw.location_id) || defaultUnitByListType.get(raw.list_type) || null;
      return {
        ...raw,
        expiry_key: toDateKey(raw.expiry_date),
        days_left: daysUntil(raw.expiry_date, today),
        storage_unit_id: unit ? unit.id : null,
        storage_unit_name: unit ? unit.name : this.listTypeLabel(raw.list_type),
      };
    });

    return {
      today,
      fetchedAt: Date.now(),
      inventory: items,
      shopping,
      openShopping: shopping.filter((s) => !s.checked),
      units,
      locations,
    };
  }

  listTypeLabel(listType) {
    const key = `list_type.${listType}`;
    const label = this.homey.__(key);
    return label && label !== key ? label : (listType || '');
  }

  relativeDays(days) {
    if (days === null || days === undefined) return '';
    if (days < 0) return this.homey.__('rel.expired');
    if (days === 0) return this.homey.__('rel.today');
    if (days === 1) return this.homey.__('rel.tomorrow');
    return this.homey.__('rel.days', { days });
  }

  // ── Devices ─────────────────────────────────────────────────────────────

  _allDevices() {
    const devices = [];
    for (const id of ['storage-unit', 'shopping', 'household']) {
      try { devices.push(...this.homey.drivers.getDriver(id).getDevices()); } catch { /* driver not ready */ }
    }
    return devices;
  }

  async _updateDevices(snapshot) {
    await Promise.all(this._allDevices().map((device) => device.updateFromSnapshot(snapshot)
      .catch((err) => this.error(`${device.getName()}:`, err.message))));
  }

  _setDevicesAvailable() {
    for (const device of this._allDevices()) device.setAvailable().catch(() => {});
  }

  _setDevicesUnavailable(message) {
    for (const device of this._allDevices()) device.setUnavailable(message).catch(() => {});
  }

  // ── Change detection (diff between polls) ───────────────────────────────

  _itemTokens(item) {
    return {
      item_name: item.name || '',
      quantity: Number(item.quantity) || 0,
      unit: item.unit || 'stk',
      storage_unit: item.storage_unit_name || '',
      expiry_date: item.expiry_key || '',
    };
  }

  _shoppingTokens(item) {
    return {
      item_name: shoppingName(item),
      quantity: Number(item.quantity) || 0,
      unit: item.unit || 'stk',
      added_by: item.added_by || '',
      checked_by: item.checked_by || '',
    };
  }

  _detectInventoryChanges(prev, next) {
    const prevIds = new Set(prev.inventory.map((i) => i.id));
    const nextIds = new Set(next.inventory.map((i) => i.id));
    for (const item of next.inventory) {
      if (!prevIds.has(item.id)) this._fire(this._trigItemAdded, this._itemTokens(item));
    }
    for (const item of prev.inventory) {
      if (!nextIds.has(item.id)) this._fire(this._trigItemRemoved, this._itemTokens(item));
    }
  }

  _detectShoppingChanges(prev, next) {
    const prevById = new Map(prev.shopping.map((s) => [s.id, s]));
    const nextIds = new Set(next.shopping.map((s) => s.id));
    for (const item of next.shopping) {
      const before = prevById.get(item.id);
      if (!before) {
        if (!item.checked) this._fire(this._trigShoppingAdded, this._shoppingTokens(item));
      } else if (!before.checked && item.checked) {
        this._fire(this._trigShoppingChecked, this._shoppingTokens(item));
      }
    }
    for (const item of prev.shopping) {
      if (!nextIds.has(item.id) && !item.checked) this._fire(this._trigShoppingRemoved, this._shoppingTokens(item));
    }

    const open = next.openShopping.length;
    const prevOpen = prev.openShopping.length;
    if (open > prevOpen) this._fire(this._trigShoppingCountAbove, {}, { count: open });
    if (prevOpen > 0 && open === 0) this._fire(this._trigShoppingDone, {});
  }

  _checkExpiry(snapshot) {
    const { today } = snapshot;

    // "Expires soon/today": once per item per day. Persisted so a restart does not re-fire.
    let soon = this.homey.settings.get('state_expiry_fired') || {};
    if (soon.day !== today) soon = { day: today, ids: [] };
    const soonIds = new Set(soon.ids);

    // "Expired": once per item, ever. Pruned when the item disappears.
    const expiredIds = new Set(this.homey.settings.get('state_expired_fired') || []);
    const currentIds = new Set();

    for (const item of snapshot.inventory) {
      currentIds.add(item.id);
      const d = item.days_left;
      if (d === null || d === undefined) continue;

      if (d >= 0 && d <= EXPIRY_LOOKAHEAD_DAYS && !soonIds.has(item.id)) {
        soonIds.add(item.id);
        this._fire(this._trigItemExpiresSoon, { ...this._itemTokens(item), days_left: d }, { daysLeft: d });
        if (d === 0) this._fire(this._trigItemExpiresToday, this._itemTokens(item));
      }
      if (d < 0 && !expiredIds.has(item.id)) {
        expiredIds.add(item.id);
        this._fire(this._trigItemExpired, this._itemTokens(item));
      }
    }

    this._persistState('state_expiry_fired', { day: today, ids: [...soonIds] });
    this._persistState('state_expired_fired', [...expiredIds].filter((id) => currentIds.has(id)));
  }

  /** Write a state key only when it changed, so an unchanged poll does not touch storage. */
  _persistState(key, value) {
    if (JSON.stringify(this.homey.settings.get(key)) !== JSON.stringify(value)) {
      this.homey.settings.set(key, value);
    }
  }

  _fire(card, tokens, state = {}) {
    card.trigger(tokens, state).catch((err) => this.error('trigger failed:', err.message));
  }

  // ── Helpers for flow cards ──────────────────────────────────────────────

  _requireApi() {
    if (!this.api) throw new Error(this.homey.__('error.not_configured'));
    return this.api;
  }

  _requireSnapshot() {
    this._requireApi();
    if (!this.snapshot) throw new Error(this.lastError || this.homey.__('error.no_data'));
    return this.snapshot;
  }

  async _getCatalog() {
    const api = this._requireApi();
    if (Date.now() - this._catalogCache.at > CATALOG_CACHE_MS) {
      this._catalogCache = { at: Date.now(), items: await api.getCatalog() };
    }
    return this._catalogCache.items;
  }

  /** Refresh after a change so the next card in the same Flow sees fresh data. */
  _afterMutation() {
    this._catalogCache.at = 0;
    return this.poll().catch(() => {});
  }

  _matches(query, ...fields) {
    const q = norm(query);
    return !q || fields.some((f) => norm(f).includes(q));
  }

  _acShopping(query) {
    if (!this.snapshot) return [];
    return this.snapshot.openShopping
      .filter((i) => this._matches(query, shoppingName(i)))
      .slice(0, 50)
      .map((i) => ({ id: i.id, name: shoppingName(i), description: `${i.quantity} ${i.unit || 'stk'}` }));
  }

  _acInventory(query) {
    if (!this.snapshot) return [];
    return this.snapshot.inventory
      .filter((i) => this._matches(query, i.name, i.storage_unit_name))
      .slice(0, 50)
      .map((i) => ({
        id: i.id,
        name: i.name,
        description: [
          `${i.quantity} ${i.unit || 'stk'}`,
          i.storage_unit_name,
          i.expiry_key ? `${shortDate(i.expiry_key)} (${this.relativeDays(i.days_left)})` : null,
        ].filter(Boolean).join(' · '),
      }));
  }

  async _acCatalog(query) {
    if (!this.api) return [];
    try {
      return (await this._getCatalog())
        .filter((p) => this._matches(query, p.name, p.brand))
        .slice(0, 50)
        .map((p) => ({
          id: p.id,
          name: p.name,
          description: [p.brand, this.listTypeLabel(p.category), `${this.homey.__('stock')}: ${Number(p.in_stock) || 0}`]
            .filter(Boolean).join(' · '),
        }));
    } catch { return []; }
  }

  /** Product names from catalog + inventory, deduplicated; id is the normalised name. */
  async _acProductNames(query) {
    if (!this.snapshot) return [];
    const names = new Map();
    for (const i of this.snapshot.inventory) if (i.name) names.set(norm(i.name), i.name);
    try {
      for (const p of await this._getCatalog()) if (p.name) names.set(norm(p.name), p.name);
    } catch { /* catalog optional here */ }
    return [...names.entries()]
      .filter(([, name]) => this._matches(query, name))
      .sort((a, b) => a[1].localeCompare(b[1]))
      .slice(0, 50)
      .map(([id, name]) => ({ id, name }));
  }

  _acUnits(query, { includeAll = false } = {}) {
    if (!this.snapshot) return [];
    const list = this.snapshot.units
      .filter((u) => this._matches(query, u.name))
      .map((u) => ({ id: u.id, name: u.name, description: this.listTypeLabel(u.list_type) }));
    if (includeAll && this._matches(query, this.homey.__('all_units'))) {
      list.unshift({ id: ALL_UNITS, name: this.homey.__('all_units') });
    }
    return list;
  }

  _itemsInUnit(unitArg) {
    const snap = this._requireSnapshot();
    if (!unitArg || unitArg.id === ALL_UNITS) return snap.inventory;
    return snap.inventory.filter((i) => i.storage_unit_id === unitArg.id);
  }

  _stockByName(name) {
    const snap = this._requireSnapshot();
    const key = norm(name);
    const matching = snap.inventory.filter((i) => norm(i.name) === key);
    return {
      quantity: matching.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0),
      unit: matching.length ? (matching[0].unit || 'stk') : 'stk',
    };
  }

  _findOpenShoppingByName(name) {
    const snap = this._requireSnapshot();
    return snap.openShopping.find((i) => norm(shoppingName(i)) === norm(name)) || null;
  }

  _findInventoryByName(name) {
    const snap = this._requireSnapshot();
    const key = norm(name);
    // Prefer the item expiring first so "use" consumes oldest stock.
    return snap.inventory
      .filter((i) => norm(i.name) === key)
      .sort((a, b) => (a.days_left ?? 9999) - (b.days_left ?? 9999))[0] || null;
  }

  _expiryDateFromDays(days) {
    const n = Number(days);
    if (!n || n <= 0) return null;
    const [y, m, d] = this._requireSnapshot().today.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }

  async _addByName({ name, quantity, unit, days }) {
    const api = this._requireApi();
    const cleanName = String(name || '').trim();
    if (!cleanName) throw new Error(this.homey.__('error.name_required'));
    const catalog = await this._getCatalog();
    let product = catalog.find((p) => norm(p.name) === norm(cleanName));
    if (!product) {
      product = await api.createCatalogProduct({ name: cleanName, category: unit.list_type || 'pantry' });
      this._catalogCache.at = 0;
    }
    return api.addInventoryItem({
      productId: product.id,
      listType: unit.list_type,
      quantity: Math.max(1, Math.round(Number(quantity) || 1)),
      expiryDate: this._expiryDateFromDays(days),
    });
  }

  async _addToShopping(rawName, quantity, unit) {
    const api = this._requireApi();
    const name = String(rawName || '').trim();
    if (!name) throw new Error(this.homey.__('error.name_required'));
    let productId = null;
    try {
      const product = (await this._getCatalog()).find((p) => norm(p.name) === norm(name));
      if (product) productId = product.id;
    } catch { /* fall back to custom name */ }
    await api.addToShopping({ productId, name, quantity: Number(quantity) || 1, unit: (unit || '').trim() || 'stk' });
    await this._afterMutation();
  }

  _expiringText(items, days) {
    const list = items
      .filter((i) => i.days_left !== null && i.days_left !== undefined && i.days_left <= days)
      .sort((a, b) => a.days_left - b.days_left);
    return {
      count: list.length,
      text: list.map((i) => `${i.name} (${this.relativeDays(i.days_left)})`).join(', '),
    };
  }

  // ── Flow cards ──────────────────────────────────────────────────────────

  _registerFlowCards() {
    const flow = this.homey.flow;

    // Triggers
    this._trigItemExpiresSoon = flow.getTriggerCard('item_expires_soon');
    this._trigItemExpiresSoon.registerRunListener(async (args, state) => state.daysLeft <= args.days);
    this._trigItemExpiresToday = flow.getTriggerCard('item_expires_today');
    this._trigItemExpired = flow.getTriggerCard('item_expired');
    this._trigItemAdded = flow.getTriggerCard('item_added');
    this._trigItemRemoved = flow.getTriggerCard('item_removed');
    this._trigShoppingAdded = flow.getTriggerCard('shopping_item_added');
    this._trigShoppingChecked = flow.getTriggerCard('shopping_item_checked');
    this._trigShoppingRemoved = flow.getTriggerCard('shopping_item_removed');
    this._trigShoppingDone = flow.getTriggerCard('shopping_list_done');
    this._trigShoppingCountAbove = flow.getTriggerCard('shopping_count_above');
    this._trigShoppingCountAbove.registerRunListener(async (args, state) => state.count > args.count);

    // Conditions
    const hasInStock = flow.getConditionCard('has_in_stock');
    hasInStock.registerArgumentAutocompleteListener('product', (q) => this._acProductNames(q));
    hasInStock.registerRunListener(async (args) => {
      const { quantity } = this._stockByName(args.product.name);
      return quantity >= (Number(args.quantity) || 1);
    });

    flow.getConditionCard('is_on_shopping_list').registerRunListener(async (args) => {
      return !!this._findOpenShoppingByName(args.name);
    });

    const hasExpired = flow.getConditionCard('has_expired_items');
    hasExpired.registerArgumentAutocompleteListener('unit', (q) => this._acUnits(q, { includeAll: true }));
    hasExpired.registerRunListener(async (args) => this._itemsInUnit(args.unit).some((i) => i.days_left !== null && i.days_left < 0));

    const expiringWithin = flow.getConditionCard('items_expiring_within');
    expiringWithin.registerArgumentAutocompleteListener('unit', (q) => this._acUnits(q, { includeAll: true }));
    expiringWithin.registerRunListener(async (args) => this._itemsInUnit(args.unit)
      .some((i) => i.days_left !== null && i.days_left >= 0 && i.days_left <= args.days));

    flow.getConditionCard('shopping_has_more_than').registerRunListener(async (args) => {
      return this._requireSnapshot().openShopping.length > args.count;
    });

    // Actions — shopping list
    flow.getActionCard('add_to_shopping').registerRunListener(async (args) => {
      await this._addToShopping(args.name, args.quantity, args.unit);
    });

    const deleteShopping = flow.getActionCard('delete_shopping_item');
    deleteShopping.registerArgumentAutocompleteListener('item', (q) => this._acShopping(q));
    deleteShopping.registerRunListener(async (args) => {
      await this._requireApi().deleteShoppingItem(args.item.id);
      await this._afterMutation();
    });

    flow.getActionCard('delete_shopping_item_by_name').registerRunListener(async (args) => {
      const item = this._findOpenShoppingByName(args.name);
      if (!item) throw new Error(this.homey.__('error.not_on_list', { name: args.name }));
      await this._requireApi().deleteShoppingItem(item.id);
      await this._afterMutation();
    });

    const checkShopping = flow.getActionCard('check_shopping_item');
    checkShopping.registerArgumentAutocompleteListener('item', (q) => this._acShopping(q));
    checkShopping.registerRunListener(async (args) => {
      await this._requireApi().checkShoppingItem(args.item.id);
      await this._afterMutation();
    });

    flow.getActionCard('check_shopping_item_by_name').registerRunListener(async (args) => {
      const item = this._findOpenShoppingByName(args.name);
      if (!item) throw new Error(this.homey.__('error.not_on_list', { name: args.name }));
      await this._requireApi().checkShoppingItem(item.id);
      await this._afterMutation();
    });

    flow.getActionCard('clear_checked_shopping').registerRunListener(async () => {
      await this._requireApi().clearCheckedShopping();
      await this._afterMutation();
    });

    flow.getActionCard('get_shopping_list_text').registerRunListener(async () => {
      const open = this._requireSnapshot().openShopping;
      return {
        count: open.length,
        text: open.map((i) => `${shoppingName(i)} (${i.quantity} ${i.unit || 'stk'})`).join(', '),
      };
    });

    // Actions — inventory
    const useItem = flow.getActionCard('use_item');
    useItem.registerArgumentAutocompleteListener('item', (q) => this._acInventory(q));
    useItem.registerRunListener(async (args) => {
      await this._requireApi().useItem(args.item.id, Number(args.amount) || 1);
      await this._afterMutation();
    });

    flow.getActionCard('use_item_by_name').registerRunListener(async (args) => {
      const item = this._findInventoryByName(args.name);
      if (!item) throw new Error(this.homey.__('error.not_in_stock', { name: args.name }));
      await this._requireApi().useItem(item.id, Number(args.amount) || 1);
      await this._afterMutation();
    });

    const setQuantity = flow.getActionCard('set_item_quantity');
    setQuantity.registerArgumentAutocompleteListener('item', (q) => this._acInventory(q));
    setQuantity.registerRunListener(async (args) => {
      const item = this._requireSnapshot().inventory.find((i) => i.id === args.item.id);
      if (!item) throw new Error(this.homey.__('error.not_in_stock', { name: args.item.name }));
      await this._requireApi().updateInventoryItem(item, { quantity: Math.max(0, Math.round(Number(args.quantity) || 0)) });
      await this._afterMutation();
    });

    const removeItem = flow.getActionCard('remove_inventory_item');
    removeItem.registerArgumentAutocompleteListener('item', (q) => this._acInventory(q));
    removeItem.registerRunListener(async (args) => {
      await this._requireApi().deleteInventoryItem(args.item.id);
      await this._afterMutation();
    });

    const addItem = flow.getActionCard('add_inventory_item');
    addItem.registerArgumentAutocompleteListener('product', (q) => this._acCatalog(q));
    addItem.registerArgumentAutocompleteListener('unit', (q) => this._acUnits(q));
    addItem.registerRunListener(async (args) => {
      const unit = this._requireSnapshot().units.find((u) => u.id === args.unit.id);
      if (!unit) throw new Error(this.homey.__('error.unit_missing'));
      await this._requireApi().addInventoryItem({
        productId: args.product.id,
        listType: unit.list_type,
        quantity: Math.max(1, Math.round(Number(args.quantity) || 1)),
        expiryDate: this._expiryDateFromDays(args.days),
      });
      await this._afterMutation();
    });

    const addByName = flow.getActionCard('add_inventory_item_by_name');
    addByName.registerArgumentAutocompleteListener('unit', (q) => this._acUnits(q));
    addByName.registerRunListener(async (args) => {
      const unit = this._requireSnapshot().units.find((u) => u.id === args.unit.id);
      if (!unit) throw new Error(this.homey.__('error.unit_missing'));
      await this._addByName({ name: args.name, quantity: args.quantity, unit, days: args.days });
      await this._afterMutation();
    });

    const getStock = flow.getActionCard('get_stock_count');
    getStock.registerArgumentAutocompleteListener('product', (q) => this._acProductNames(q));
    getStock.registerRunListener(async (args) => this._stockByName(args.product.name));

    const getExpiring = flow.getActionCard('get_expiring_text');
    getExpiring.registerArgumentAutocompleteListener('unit', (q) => this._acUnits(q, { includeAll: true }));
    getExpiring.registerRunListener(async (args) => this._expiringText(this._itemsInUnit(args.unit), Number(args.days) || 0));

    this._registerDeviceCards(flow);

    // Actions — catalog & structure
    flow.getActionCard('create_catalog_product').registerRunListener(async (args) => {
      await this._requireApi().createCatalogProduct({
        name: String(args.name || '').trim(),
        unit: (args.unit || '').trim() || 'stk',
        category: args.category || 'pantry',
        brand: (args.brand || '').trim() || null,
      });
      this._catalogCache.at = 0;
    });

    flow.getActionCard('create_storage_unit').registerRunListener(async (args) => {
      await this._requireApi().createStorageUnit({ name: String(args.name || '').trim(), listType: args.list_type });
      await this._afterMutation();
    });

    const createShelf = flow.getActionCard('create_shelf');
    createShelf.registerArgumentAutocompleteListener('unit', (q) => this._acUnits(q));
    createShelf.registerRunListener(async (args) => {
      const unit = this._requireSnapshot().units.find((u) => u.id === args.unit.id);
      if (!unit) throw new Error(this.homey.__('error.unit_missing'));
      await this._requireApi().createShelf({ name: String(args.name || '').trim(), storageUnitId: unit.id, listType: unit.list_type });
      await this._afterMutation();
    });

    flow.getActionCard('refresh').registerRunListener(async () => {
      this._requireApi();
      await this.poll();
      if (this.lastError) throw new Error(this.lastError);
    });
  }

  // ── Device cards (the device itself is the storage unit / shopping list) ─

  _unitOfDevice(device) {
    const unitId = device.getData().storage_unit_id;
    const unit = this._requireSnapshot().units.find((u) => u.id === unitId);
    if (!unit) throw new Error(this.homey.__('error.unit_deleted'));
    return unit;
  }

  _acInventoryInUnit(query, args) {
    if (!this.snapshot || !args || !args.device) return [];
    const unitId = args.device.getData().storage_unit_id;
    return this._acInventory(query).filter((entry) => {
      const item = this.snapshot.inventory.find((i) => i.id === entry.id);
      return item && item.storage_unit_id === unitId;
    });
  }

  _registerDeviceCards(flow) {
    // Storage unit
    const unitAdd = flow.getActionCard('unit_add_item');
    unitAdd.registerArgumentAutocompleteListener('product', (q) => this._acCatalog(q));
    unitAdd.registerRunListener(async (args) => {
      const unit = this._unitOfDevice(args.device);
      await this._requireApi().addInventoryItem({
        productId: args.product.id,
        listType: unit.list_type,
        quantity: Math.max(1, Math.round(Number(args.quantity) || 1)),
        expiryDate: this._expiryDateFromDays(args.days),
      });
      await this._afterMutation();
    });

    flow.getActionCard('unit_add_item_by_name').registerRunListener(async (args) => {
      const unit = this._unitOfDevice(args.device);
      await this._addByName({ name: args.name, quantity: args.quantity, unit, days: args.days });
      await this._afterMutation();
    });

    const unitUse = flow.getActionCard('unit_use_item');
    unitUse.registerArgumentAutocompleteListener('item', (q, args) => this._acInventoryInUnit(q, args));
    unitUse.registerRunListener(async (args) => {
      await this._requireApi().useItem(args.item.id, Number(args.amount) || 1);
      await this._afterMutation();
    });

    const unitRemove = flow.getActionCard('unit_remove_item');
    unitRemove.registerArgumentAutocompleteListener('item', (q, args) => this._acInventoryInUnit(q, args));
    unitRemove.registerRunListener(async (args) => {
      await this._requireApi().deleteInventoryItem(args.item.id);
      await this._afterMutation();
    });

    flow.getActionCard('unit_get_expiring_text').registerRunListener(async (args) => {
      const unit = this._unitOfDevice(args.device);
      return this._expiringText(this._itemsInUnit({ id: unit.id }), Number(args.days) || 0);
    });

    // Shopping list
    flow.getActionCard('list_add').registerRunListener(async (args) => {
      await this._addToShopping(args.name, args.quantity, args.unit);
    });

    const listCheck = flow.getActionCard('list_check');
    listCheck.registerArgumentAutocompleteListener('item', (q) => this._acShopping(q));
    listCheck.registerRunListener(async (args) => {
      await this._requireApi().checkShoppingItem(args.item.id);
      await this._afterMutation();
    });

    flow.getActionCard('list_check_by_name').registerRunListener(async (args) => {
      const item = this._findOpenShoppingByName(args.name);
      if (!item) throw new Error(this.homey.__('error.not_on_list', { name: args.name }));
      await this._requireApi().checkShoppingItem(item.id);
      await this._afterMutation();
    });

    const listRemove = flow.getActionCard('list_remove');
    listRemove.registerArgumentAutocompleteListener('item', (q) => this._acShopping(q));
    listRemove.registerRunListener(async (args) => {
      await this._requireApi().deleteShoppingItem(args.item.id);
      await this._afterMutation();
    });

    flow.getActionCard('list_remove_by_name').registerRunListener(async (args) => {
      const item = this._findOpenShoppingByName(args.name);
      if (!item) throw new Error(this.homey.__('error.not_on_list', { name: args.name }));
      await this._requireApi().deleteShoppingItem(item.id);
      await this._afterMutation();
    });

    flow.getActionCard('list_clear_checked').registerRunListener(async () => {
      await this._requireApi().clearCheckedShopping();
      await this._afterMutation();
    });
  }

  // ── Dashboard widget (widgets/shopping-list) ─────────────────────────────

  _shoppingPayload(snapshot) {
    const row = (i) => ({
      id: i.id,
      name: shoppingName(i),
      quantity: Number(i.quantity) || 0,
      unit: i.unit || 'stk',
      checked: !!i.checked,
      checked_by: i.checked_by || '',
    });
    return {
      open: snapshot.openShopping.map(row),
      checked: snapshot.shopping.filter((i) => i.checked).map(row),
    };
  }

  /** Push the shopping list to open widgets when it changed. */
  _emitShoppingRealtime(snapshot) {
    const payload = this._shoppingPayload(snapshot);
    const key = JSON.stringify(payload);
    if (key === this._lastShoppingEmitted) return;
    this._lastShoppingEmitted = key;
    if (this.homey.api && typeof this.homey.api.realtime === 'function') {
      this.homey.api.realtime('kitchey:shopping', payload).catch((err) => this.error('realtime failed:', err.message));
    }
  }

  getShoppingForWidget() {
    return this._shoppingPayload(this._requireSnapshot());
  }

  async addShoppingFromWidget(name) {
    await this._addToShopping(name, 1, '');
  }

  async setShoppingCheckedFromWidget(id, checked) {
    await this._requireApi().checkShoppingItem(id, !!checked);
    await this._afterMutation();
  }

  async deleteShoppingFromWidget(id) {
    await this._requireApi().deleteShoppingItem(id);
    await this._afterMutation();
  }

  async clearCheckedFromWidget() {
    await this._requireApi().clearCheckedShopping();
    await this._afterMutation();
  }

  // ── Settings page API (see api.js) ──────────────────────────────────────

  async testConnection({ serverUrl, token }) {
    const api = new KitcheyApi({ serverUrl, token, householdId: null });
    const households = await api.getHouseholds();
    let isPremium = null;
    try { isPremium = !!(await api.getPremiumStatus()).isPremium; } catch { /* optional */ }
    return {
      households: (Array.isArray(households) ? households : []).map((h) => ({
        id: h.id, name: h.name, icon: h.icon || '', role: h.role, member_count: Number(h.member_count) || 0,
      })),
      isPremium,
    };
  }

  getStatus() {
    const snap = this.snapshot;
    return {
      configured: this.isConfigured(),
      lastError: this.lastError,
      fetchedAt: snap ? snap.fetchedAt : null,
      items: snap ? snap.inventory.length : 0,
      expired: snap ? computeStats(snap.inventory).expired : 0,
      openShopping: snap ? snap.openShopping.length : 0,
      units: snap ? snap.units.map((u) => u.name) : [],
    };
  }
}

module.exports = KitcheyApp;
