'use strict';

const Homey = require('homey');
const { ensureCapabilities, applyInventoryStats, setIfChanged } = require('../../lib/deviceStats');

class HouseholdDevice extends Homey.Device {
  async onInit() {
    await ensureCapabilities(this);
    const { snapshot } = this.homey.app;
    if (snapshot) await this.updateFromSnapshot(snapshot);
    else this.homey.app.poll().catch(() => {});
  }

  async updateFromSnapshot(snapshot) {
    await applyInventoryStats(this, snapshot.inventory);
    await setIfChanged(this, 'measure_shopping_count', snapshot.openShopping.length);
  }
}

module.exports = HouseholdDevice;
