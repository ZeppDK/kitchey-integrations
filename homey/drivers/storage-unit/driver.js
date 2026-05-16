'use strict';

const Homey = require('homey');

class StorageUnitDriver extends Homey.Driver {
  async onInit() {
    this.log('StorageUnitDriver ready');
  }

  /**
   * Called by app.js after each poll to sync devices with current storage units.
   * Creates devices for new units, removes devices for deleted units.
   */
  async syncDevices(storageUnits, app) {
    const existing = this.getDevices();
    const existingIds = new Set(existing.map((d) => d.getData().storage_unit_id));
    const apiIds = new Set(storageUnits.map((u) => u.id));

    // Add new
    for (const unit of storageUnits) {
      if (!existingIds.has(unit.id)) {
        try {
          await this.createDevice({
            name: unit.name,
            data: { storage_unit_id: unit.id },
            settings: { storage_unit_id: unit.id, list_type: unit.list_type || '' },
          });
          this.log(`Created device for unit: ${unit.name}`);
        } catch (err) {
          this.error(`Failed to create device for unit ${unit.name}:`, err.message);
        }
      }
    }

    // Remove deleted
    for (const device of existing) {
      if (!apiIds.has(device.getData().storage_unit_id)) {
        try {
          await device.setUnavailable('Storage unit removed from Kitchey');
        } catch {}
      }
    }
  }

  /**
   * Update all storage unit devices with fresh inventory data.
   */
  updateDevices(inventory) {
    for (const device of this.getDevices()) {
      device.updateFromInventory(inventory).catch(() => {});
    }
  }

  // Homey pair — no pairing UI needed (auto-managed)
  async onPair() {}
}

module.exports = StorageUnitDriver;
