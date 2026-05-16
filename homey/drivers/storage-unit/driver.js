'use strict';

const Homey = require('homey');

class StorageUnitDriver extends Homey.Driver {
  async onInit() {
    this.log('StorageUnitDriver ready');
  }

  async onPairListDevices() {
    const app = this.homey.app;
    if (!app._api) throw new Error('Kitchey is not configured — check app settings.');
    const units = await app._api.getStorageUnits();
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
