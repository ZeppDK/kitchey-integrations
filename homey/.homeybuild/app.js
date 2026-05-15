'use strict';

const Homey = require('homey');
const KitcheyApi = require('./api');

class KitcheyApp extends Homey.App {
  async onInit() {
    this.log('Kitchey starting...');
    this._api = null;
    this._pollInterval = null;
    this._lastShoppingCount = 0;
    // Track which items have fired today: "itemId:YYYY-MM-DD" → Set of daysLeft thresholds fired
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
    const serverUrl = this.homey.settings.get('server_url');
    const token = this.homey.settings.get('token');
    const householdId = this.homey.settings.get('household_id');
    if (!serverUrl || !token || !householdId) return;

    this._api = new KitcheyApi({ serverUrl, token, householdId });
    await this._poll();
    this._pollInterval = setInterval(() => this._poll(), 30 * 60 * 1000);
  }

  async _poll() {
    if (!this._api) return;
    try {
      const [inventory, shopping] = await Promise.all([
        this._api.getInventory(),
        this._api.getShopping(),
      ]);
      this._checkExpiry(inventory);
      this._checkShopping(shopping);
    } catch (err) {
      this.error('Poll failed:', err.message);
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

      // Fire once per item per day (reset after midnight via key containing today)
      const fireKey = `${item.id}:${todayKey}`;
      if (this._firedExpiry.has(fireKey)) continue;
      this._firedExpiry.set(fireKey, true);

      this._triggerItemExpiresSoon
        .trigger(
          { item_name: item.name, expiry_date: item.expiry_date.slice(0, 10), quantity: item.quantity },
          { daysLeft },
        )
        .catch(() => {});
    }

    // Prune old keys to avoid unbounded growth
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

  _registerFlowCards() {
    // Triggers
    this._triggerItemExpiresSoon = this.homey.flow.getTriggerCard('item_expires_soon');
    this._triggerItemExpiresSoon.registerRunListener(async (args, state) => {
      // Fire when item's daysLeft is within the threshold set in the flow card
      return state.daysLeft <= args.days;
    });

    this._triggerShoppingCountAbove = this.homey.flow.getTriggerCard('shopping_count_above');
    this._triggerShoppingCountAbove.registerRunListener(async (args, state) => {
      return state.count > args.count;
    });

    // Actions
    this.homey.flow.getActionCard('add_to_shopping').registerRunListener(async (args) => {
      if (!this._api) throw new Error('Kitchey not configured — check app settings');
      const { status } = await this._api.addToShopping(args.name);
      if (status !== 200 && status !== 201) throw new Error(`API error: ${status}`);
    });

    const useItemCard = this.homey.flow.getActionCard('use_item');
    useItemCard.registerArgumentAutocompleteListener('item', async (query) => {
      if (!this._api) return [];
      try {
        const inventory = await this._api.getInventory();
        return inventory
          .filter(i => !query || i.name.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 50)
          .map(i => ({
            id: i.id,
            name: i.name,
            description: `Antal: ${i.quantity}${i.expiry_date ? ' · Udløber: ' + i.expiry_date.slice(0, 10) : ''}`,
          }));
      } catch { return []; }
    });
    useItemCard.registerRunListener(async (args) => {
      if (!this._api) throw new Error('Kitchey not configured — check app settings');
      const { status } = await this._api.useItem(args.item.id, args.amount ?? 1);
      if (status !== 200) throw new Error(`API error: ${status}`);
    });
  }
}

module.exports = KitcheyApp;
