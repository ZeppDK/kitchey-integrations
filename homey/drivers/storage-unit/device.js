'use strict';

const Homey = require('homey');
const { ensureCapabilities, applyInventoryStats } = require('../../lib/deviceStats');

class StorageUnitDevice extends Homey.Device {
  async onInit() {
    await ensureCapabilities(this);
    const { snapshot } = this.homey.app;
    if (snapshot) await this.updateFromSnapshot(snapshot);
    else this.homey.app.poll().catch(() => {});
  }

  async updateFromSnapshot(snapshot) {
    const unitId = this.getData().storage_unit_id;
    const unit = snapshot.units.find((u) => u.id === unitId);
    if (!unit) {
      await this.setUnavailable(this.homey.__('error.unit_deleted')).catch(() => {});
      return;
    }
    const items = snapshot.inventory.filter((i) => i.storage_unit_id === unitId);
    await applyInventoryStats(this, items);
  }
}

module.exports = StorageUnitDevice;
