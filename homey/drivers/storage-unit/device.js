'use strict';

const Homey = require('homey');

class StorageUnitDevice extends Homey.Device {
  async onInit() {
    this.log('StorageUnitDevice init:', this.getName());
    const app = this.homey.app;
    if (app._lastInventory && app._lastInventory.length > 0) {
      await this.updateFromInventory(app._lastInventory).catch((err) => this.error('updateFromInventory failed:', err.message));
    } else {
      app._poll().catch((err) => this.error('poll failed:', err.message));
    }
  }

  async updateFromInventory(inventory) {
    // Items from the Kitchey API carry list_type (fridge/freezer/pantry), not storage_unit_id.
    // Match by the list_type stored on this device.
    const listType = this.getSettings().list_type;
    const items = inventory.filter((i) => i.list_type === listType);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let expiring3 = 0;
    let expiring7 = 0;
    for (const item of items) {
      if (!item.expiry_date) continue;
      const exp = new Date(item.expiry_date.slice(0, 10));
      exp.setHours(0, 0, 0, 0);
      const days = Math.round((exp - today) / 86400000);
      if (days >= 0 && days <= 3) expiring3++;
      if (days >= 0 && days <= 7) expiring7++;
    }

    await this.setCapabilityValue('measure_item_count', items.length).catch(() => {});
    await this.setCapabilityValue('measure_expiring_3d', expiring3).catch(() => {});
    await this.setCapabilityValue('measure_expiring_7d', expiring7).catch(() => {});
  }

  async onSettings({ newSettings }) {
    this.log('Settings updated:', newSettings);
  }

  async onDeleted() {
    this.log('StorageUnitDevice deleted:', this.getName());
  }
}

module.exports = StorageUnitDevice;
