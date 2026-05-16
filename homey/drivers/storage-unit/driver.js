'use strict';

const Homey = require('homey');

class StorageUnitDriver extends Homey.Driver {
  async onInit() {
    this.log('StorageUnitDriver ready');
  }

  async onPairListDevices() {
    const app = this.homey.app;
    if (!app._api) throw new Error('Kitchey is not configured — check app settings.');
    let units;
    try {
      units = await app._api.getStorageUnits();
    } catch (err) {
      throw new Error(`getStorageUnits fejlede: ${err.message}`);
    }
    if (!Array.isArray(units) || units.length === 0) {
      const serverUrl = this.homey.settings.get('server_url');
      const householdId = this.homey.settings.get('household_id');
      throw new Error(`API returnerede ingen enheder. Server: ${serverUrl}, Husstand: ${householdId}, Rådata: ${JSON.stringify(units)}`);
    }
    return units.map((unit) => ({
      name: unit.name,
      data: { storage_unit_id: unit.id },
      settings: { storage_unit_id: unit.id, list_type: unit.list_type || '' },
    }));
  }

  updateDevices(inventory) {
    for (const device of this.getDevices()) {
      device.updateFromInventory(inventory).catch(() => {});
    }
  }
}

module.exports = StorageUnitDriver;
