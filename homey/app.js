'use strict';

const Homey = require('homey');
const KitcheyApi = require('./api');

class KitcheyApp extends Homey.App {
  async onInit() {
    this.log('Kitchey starting...');
    this._api = null;
    this._pollInterval = null;
    this._lastShoppingCount = 0;
    this._lastInventory = [];
    this._lastShopping = [];
    this._firedExpiry = new Map();

    this._registerFlowCards();

    this.homey.settings.on('set', () => this._reinit());
    await this._reinit();
    this.log('Kitchey ready');
  }

  async _reinit() {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
    const serverUrl   = this.homey.settings.get('server_url');
    const token       = this.homey.settings.get('token');
    const householdId = this.homey.settings.get('household_id');
    if (!serverUrl || !token || !householdId) return;

    this._api = new KitcheyApi({ serverUrl, token, householdId });
    await this._poll();
    this._pollInterval = setInterval(() => this._poll(), 10 * 60 * 1000);
  }

  async _poll() {
    if (!this._api) return;
    try {
      const [inventory, shopping, storageUnits] = await Promise.all([
        this._api.getInventory(),
        this._api.getShopping(),
        this._api.getStorageUnits(),
      ]);

      this._lastInventory = inventory;
      this._lastShopping = shopping;

      // Sync devices and update capabilities
      const suDriver = this.homey.drivers.getDriver('storage-unit');
      const shDriver = this.homey.drivers.getDriver('shopping');
      await suDriver.syncDevices(storageUnits);
      suDriver.updateDevices(inventory);
      const householdId = this.homey.settings.get('household_id');
      await shDriver.ensureDevice(householdId);
      shDriver.updateDevices(shopping);

      this._checkExpiry(inventory);
      this._checkShopping(shopping);
    } catch (err) {
      this.error('Poll failed:', err.message);
      this.homey.notifications.createNotification({ excerpt: `Kitchey poll fejlede: ${err.message}` }).catch(() => {});
    }
  }

  _checkExpiry(items) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = today.toISOString().slice(0, 10);

    for (const item of items) {
      if (!item.expiry_date) continue;
      const exp = new Date(item.expiry_date.slice(0, 10));
      exp.setHours(0, 0, 0, 0);
      const daysLeft = Math.round((exp - today) / 86400000);
      if (daysLeft < 0 || daysLeft > 30) continue;

      const fireKey = `${item.id}:${todayKey}`;
      if (this._firedExpiry.has(fireKey)) continue;
      this._firedExpiry.set(fireKey, true);

      this._triggerItemExpiresSoon
        .trigger(
          { item_name: item.name, expiry_date: item.expiry_date.slice(0, 10), quantity: item.quantity },
          { daysLeft },
        )
        .catch(() => {});

      if (daysLeft === 0) {
        this._triggerItemExpiresToday
          .trigger({ item_name: item.name, quantity: item.quantity })
          .catch(() => {});
      }
    }

    for (const key of this._firedExpiry.keys()) {
      if (!key.includes(todayKey)) this._firedExpiry.delete(key);
    }
  }

  _checkShopping(shopping) {
    const unchecked = shopping.filter((s) => !s.checked).length;
    const prev = this._lastShoppingCount;
    this._lastShoppingCount = unchecked;
    if (unchecked > prev) {
      this._triggerShoppingCountAbove
        .trigger({}, { count: unchecked })
        .catch(() => {});
    }
  }

  _requireApi() {
    if (!this._api) throw new Error('Kitchey not configured — check app settings');
    return this._api;
  }

  _registerFlowCards() {
    // ── Triggers ────────────────────────────────────────────────────────

    this._triggerItemExpiresSoon = this.homey.flow.getTriggerCard('item_expires_soon');
    this._triggerItemExpiresSoon.registerRunListener(async (args, state) => {
      return state.daysLeft <= args.days;
    });

    this._triggerItemExpiresToday = this.homey.flow.getTriggerCard('item_expires_today');

    this._triggerShoppingCountAbove = this.homey.flow.getTriggerCard('shopping_count_above');
    this._triggerShoppingCountAbove.registerRunListener(async (args, state) => {
      return state.count > args.count;
    });

    // ── Shopping actions ─────────────────────────────────────────────────

    this.homey.flow.getActionCard('add_to_shopping').registerRunListener(async (args) => {
      const api = this._requireApi();
      const { status } = await api.addToShopping(args.name, args.quantity ?? 1, args.unit || 'stk');
      if (status !== 200 && status !== 201) throw new Error(`API error: ${status}`);
      this._poll().catch(() => {});
    });

    const deleteShoppingCard = this.homey.flow.getActionCard('delete_shopping_item');
    deleteShoppingCard.registerArgumentAutocompleteListener('item', async (query) => {
      if (!this._api) return [];
      return this._lastShopping
        .filter((i) => !i.checked && (!query || (i.product_name || i.custom_name || '').toLowerCase().includes(query.toLowerCase())))
        .slice(0, 50)
        .map((i) => ({
          id: i.id,
          name: i.product_name || i.custom_name || 'Ukendt',
          description: `${i.quantity} ${i.unit}`,
        }));
    });
    deleteShoppingCard.registerRunListener(async (args) => {
      const api = this._requireApi();
      const { status } = await api.deleteShoppingItem(args.item.id);
      if (status !== 200 && status !== 204) throw new Error(`API error: ${status}`);
      this._poll().catch(() => {});
    });

    const checkShoppingCard = this.homey.flow.getActionCard('check_shopping_item');
    checkShoppingCard.registerArgumentAutocompleteListener('item', async (query) => {
      if (!this._api) return [];
      return this._lastShopping
        .filter((i) => !i.checked && (!query || (i.product_name || i.custom_name || '').toLowerCase().includes(query.toLowerCase())))
        .slice(0, 50)
        .map((i) => ({
          id: i.id,
          name: i.product_name || i.custom_name || 'Ukendt',
          description: `${i.quantity} ${i.unit}`,
        }));
    });
    checkShoppingCard.registerRunListener(async (args) => {
      const api = this._requireApi();
      const { status } = await api.checkShoppingItem(args.item.id, 'Homey');
      if (status !== 200) throw new Error(`API error: ${status}`);
      this._poll().catch(() => {});
    });

    // ── Inventory actions ─────────────────────────────────────────────────

    const useItemCard = this.homey.flow.getActionCard('use_item');
    useItemCard.registerArgumentAutocompleteListener('item', async (query) => {
      if (!this._api) return [];
      return this._lastInventory
        .filter((i) => !query || i.name.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 50)
        .map((i) => ({
          id: i.id,
          name: i.name,
          description: `Antal: ${i.quantity}${i.expiry_date ? ' · Udløber: ' + i.expiry_date.slice(0, 10) : ''}`,
        }));
    });
    useItemCard.registerRunListener(async (args) => {
      const api = this._requireApi();
      const { status } = await api.useItem(args.item.id, args.amount ?? 1);
      if (status !== 200) throw new Error(`API error: ${status}`);
      this._poll().catch(() => {});
    });

    const addInventoryCard = this.homey.flow.getActionCard('add_inventory_item');
    addInventoryCard.registerArgumentAutocompleteListener('product', async (query) => {
      if (!this._api) return [];
      try {
        const catalog = await this._api.getCatalog();
        return catalog
          .filter((p) => !query || p.name.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 50)
          .map((p) => ({
            id: p.id,
            name: p.name,
            description: [p.brand, p.category].filter(Boolean).join(' · '),
          }));
      } catch { return []; }
    });
    addInventoryCard.registerRunListener(async (args) => {
      const api = this._requireApi();
      const { status } = await api.addInventoryItem(
        args.product.id,
        args.quantity ?? 1,
        args.list_type,
        args.expiry_date || null,
      );
      if (status !== 200 && status !== 201) throw new Error(`API error: ${status}`);
      this._poll().catch(() => {});
    });

    // ── Creation actions ──────────────────────────────────────────────────

    this.homey.flow.getActionCard('create_catalog_product').registerRunListener(async (args) => {
      const api = this._requireApi();
      const { status } = await api.createCatalogProduct(
        args.name,
        args.unit || 'stk',
        args.category || 'pantry',
        args.brand || null,
      );
      if (status !== 200 && status !== 201) throw new Error(`API error: ${status}`);
    });

    this.homey.flow.getActionCard('create_storage_unit').registerRunListener(async (args) => {
      const api = this._requireApi();
      const { status } = await api.createStorageUnit(args.name, args.list_type.id || args.list_type, '');
      if (status !== 200 && status !== 201) throw new Error(`API error: ${status}`);
      this._poll().catch(() => {});
    });

    const createShelfCard = this.homey.flow.getActionCard('create_shelf');
    createShelfCard.registerArgumentAutocompleteListener('unit', async (query) => {
      if (!this._api) return [];
      const units = await this._api.getStorageUnits();
      return units
        .filter((u) => !query || u.name.toLowerCase().includes(query.toLowerCase()))
        .map((u) => ({ id: u.id, name: u.name, description: u.list_type }));
    });
    createShelfCard.registerRunListener(async (args) => {
      const api = this._requireApi();
      const { status } = await api.createShelf(args.name, args.unit.id);
      if (status !== 200 && status !== 201) throw new Error(`API error: ${status}`);
      this._poll().catch(() => {});
    });
  }
}

module.exports = KitcheyApp;
