'use strict';

const Homey = require('homey');
const { ensureCapabilities, setIfChanged } = require('../../lib/deviceStats');
const { shoppingName } = require('../../lib/util');

const MAX_LISTED_ITEMS = 15;
const MAX_TEXT_ITEMS = 6;

class ShoppingDevice extends Homey.Device {
  async onInit() {
    await ensureCapabilities(this);
    const { snapshot } = this.homey.app;
    if (snapshot) await this.updateFromSnapshot(snapshot);
    else this.homey.app.poll().catch(() => {});
  }

  async updateFromSnapshot(snapshot) {
    const open = snapshot.openShopping;
    await setIfChanged(this, 'measure_shopping_count', open.length);

    const names = open.map(shoppingName);
    const text = names.length === 0
      ? this.homey.__('none')
      : names.slice(0, MAX_TEXT_ITEMS).join(', ') + (names.length > MAX_TEXT_ITEMS ? ` (+${names.length - MAX_TEXT_ITEMS})` : '');
    await setIfChanged(this, 'kitchey_shopping_list', text);

    // One sub-capability per open item so the whole list is readable on the device card.
    const listed = open.slice(0, MAX_LISTED_ITEMS);
    for (const cap of this.getCapabilities().filter((c) => c.startsWith('shopping_item.'))) {
      if (parseInt(cap.split('.')[1], 10) >= listed.length) await this.removeCapability(cap).catch(() => {});
    }
    for (let i = 0; i < listed.length; i++) {
      const capId = `shopping_item.${i}`;
      const item = listed[i];
      const name = shoppingName(item);
      if (!this.hasCapability(capId)) await this.addCapability(capId).catch(() => {});
      const options = this.getCapabilityOptions(capId) || {};
      if (!options.title || options.title.en !== name) {
        await this.setCapabilityOptions(capId, { title: { en: name, da: name } }).catch(() => {});
      }
      await setIfChanged(this, capId, `${item.quantity} ${item.unit || 'stk'}`);
    }
  }
}

module.exports = ShoppingDevice;
