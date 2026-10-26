'use strict';

// Widget API for the shopping-list dashboard widget. All handlers go through the app so the
// snapshot, Flow triggers and realtime events stay consistent.

module.exports = {
  async getList({ homey }) {
    return homey.app.getShoppingForWidget();
  },

  async addItem({ homey, body }) {
    await homey.app.addShoppingFromWidget((body && body.name) || '');
    return homey.app.getShoppingForWidget();
  },

  async setChecked({ homey, params, body }) {
    await homey.app.setShoppingCheckedFromWidget(params.id, !!(body && body.checked));
    return homey.app.getShoppingForWidget();
  },

  async deleteItem({ homey, params }) {
    await homey.app.deleteShoppingFromWidget(params.id);
    return homey.app.getShoppingForWidget();
  },

  async clearChecked({ homey }) {
    await homey.app.clearCheckedFromWidget();
    return homey.app.getShoppingForWidget();
  },
};
