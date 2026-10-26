'use strict';

const Homey = require('homey');

class StorageUnitDriver extends Homey.Driver {
  async onInit() {
    this.log('StorageUnitDriver ready');
  }

  async onPairListDevices() {
    const app = this.homey.app;
    if (!app.isConfigured()) throw new Error(this.homey.__('error.not_configured'));
    const units = await app.api.getStorageUnits();
    if (units.length === 0) throw new Error(this.homey.__('pair.no_units'));
    return units.map((unit) => ({
      name: unit.name,
      data: { storage_unit_id: unit.id },
      settings: { storage_unit_id: unit.id, list_type: app.listTypeLabel(unit.list_type) },
    }));
  }
}

module.exports = StorageUnitDriver;
