'use strict';

const { computeStats, shortDate } = require('./util');

/** Set a capability only when the value actually changed (keeps Insights and Flow quiet). */
async function setIfChanged(device, capability, value) {
  if (!device.hasCapability(capability)) return;
  if (device.getCapabilityValue(capability) === value) return;
  await device.setCapabilityValue(capability, value);
}

/** Add capabilities declared in the driver manifest that an older pairing is missing. */
async function ensureCapabilities(device) {
  const wanted = (device.driver.manifest && device.driver.manifest.capabilities) || [];
  for (const cap of wanted) {
    if (!device.hasCapability(cap)) await device.addCapability(cap).catch(() => {});
  }
}

/** Push inventory statistics for `items` onto a storage-unit or household device. */
async function applyInventoryStats(device, items) {
  const app = device.homey.app;
  const stats = computeStats(items);
  const none = device.homey.__('none');

  const next = stats.nextExpiring
    ? `${stats.nextExpiring.name} · ${shortDate(stats.nextExpiring.expiry_key)} (${app.relativeDays(stats.nextExpiring.days_left)})`
    : none;
  const latest = stats.latest
    ? `${stats.latest.name} (${stats.latest.quantity} ${stats.latest.unit || 'stk'})`
    : none;

  await setIfChanged(device, 'measure_item_count', stats.count);
  await setIfChanged(device, 'measure_expiring_3d', stats.expiring3);
  await setIfChanged(device, 'measure_expiring_7d', stats.expiring7);
  await setIfChanged(device, 'measure_expired', stats.expired);
  await setIfChanged(device, 'alarm_expired', stats.expired > 0);
  await setIfChanged(device, 'kitchey_next_expiring', next);
  await setIfChanged(device, 'kitchey_latest_item', latest);
}

module.exports = { setIfChanged, ensureCapabilities, applyInventoryStats };
