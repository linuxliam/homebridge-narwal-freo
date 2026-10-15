// Optional HomeKit (HAP) accessory next to the Matter vacuum: a "Cleaning" occupancy sensor
// (the Home app can't trigger automations on a robot vacuum's state) and each consumable's
// remaining life as a Filter Maintenance service.

const CONSUMABLE_POLL = 60 * 60 * 1000;

export class FreoSensors {
  /**
   * @param {object} opts
   * @param {import('homebridge').API} opts.api
   * @param {import('homebridge').Logging} opts.log
   * @param {import('homebridge').PlatformAccessory} opts.accessory
   * @param {object} opts.device Narwal device record
   * @param {import('./cloud.js').NarwalCloud} opts.cloud
   * @param {boolean} opts.cleaning add the Cleaning occupancy sensor
   * @param {boolean} opts.consumables add the consumables' Filter Maintenance services
   * @param {number} opts.replaceAt remaining life (%) at which a part shows "replace"
   * @param {number} opts.dockedAfter ms on the dock before the outing counts as finished
   * @param {string} opts.version plugin version
   */
  constructor({ api, log, accessory, device, cloud, cleaning, consumables, replaceAt, dockedAfter, version }) {
    this.log = log;
    this.hap = api.hap;
    this.accessory = accessory;
    this.device = device;
    this.cloud = cloud;
    this.replaceAt = replaceAt;
    this.dockedAfter = dockedAfter;
    this.parts = new Map();
    const { Service, Characteristic: C } = this.hap;

    accessory.getService(Service.AccessoryInformation)
      .setCharacteristic(C.Manufacturer, 'Narwal')
      .setCharacteristic(C.Model, device.robotName ?? 'Freo')
      .setCharacteristic(C.SerialNumber, `${device.snNumber ?? device.deviceId}-sensors`)
      .setCharacteristic(C.FirmwareRevision, version);

    const occupancy = accessory.getService(Service.OccupancySensor);
    if (cleaning) {
      this.occupancy = occupancy ?? accessory.addService(Service.OccupancySensor, accessory.displayName);
      this.occupancy.setPrimaryService(true);
      this.occupancy.updateCharacteristic(C.OccupancyDetected, C.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
    } else if (occupancy) {
      accessory.removeService(occupancy);
    }

    this.consumables = consumables;
    if (!consumables) {
      this.removeParts(new Set());
    }
  }

  start() {
    if (this.consumables) {
      this.pollConsumables();
      this.pollTimer = setInterval(() => this.pollConsumables(), CONSUMABLE_POLL);
    }
  }

  stop() {
    clearInterval(this.pollTimer);
    clearTimeout(this.dockTimer);
  }

  // ── Cleaning sensor ──

  /** Called with every robot status: occupied while the robot is away from the dock. */
  follow(onDock) {
    const { OccupancyDetected } = this.hap.Characteristic;
    if (!onDock) {
      clearTimeout(this.dockTimer);
      this.dockTimer = undefined;
      if (!this.out) {
        this.out = true;
        this.occupancy?.updateCharacteristic(OccupancyDetected, OccupancyDetected.OCCUPANCY_DETECTED);
      }
      return;
    }
    if (!this.out || this.dockTimer) {
      return;
    }
    // Mid-clean the Freo goes back to the base to wash its mops, so wait until it has stayed there.
    this.dockTimer = setTimeout(() => {
      this.dockTimer = undefined;
      this.out = false;
      this.occupancy?.updateCharacteristic(OccupancyDetected, OccupancyDetected.OCCUPANCY_NOT_DETECTED);
      if (this.consumables) {
        this.pollConsumables();
      }
    }, this.dockedAfter);
  }

  // ── Consumables ──

  async pollConsumables() {
    let items;
    try {
      items = await this.cloud.getConsumables(this.device.deviceId, this.device.productId);
    } catch (error) {
      this.log.debug(`Consumables request failed: ${error.message}`);
      return;
    }
    // Parts with a life bar in the Narwal app; the rest (dust bin, sensors, …) are "clean regularly" reminders.
    const parts = items.filter(i => i.progress_bar_switch === 1 && i.total_duration > 0 && typeof i.name === 'string');
    const first = this.parts.size === 0;
    this.removeParts(new Set(parts.map(p => `consumable-${p.type}`)));
    for (const part of parts) {
      this.applyPart(part);
    }
    if (first && parts.length) {
      this.log.info(`Consumables: ${parts.map(p => `${p.name} ${life(p)}%`).join(', ')}`);
    }
  }

  applyPart(part) {
    const { Service, Characteristic: C } = this.hap;
    const subtype = `consumable-${part.type}`;
    let service = this.accessory.getServiceById(Service.FilterMaintenance, subtype);
    if (!service) {
      service = this.accessory.addService(Service.FilterMaintenance, part.name, subtype);
      service.addOptionalCharacteristic(C.ConfiguredName);
      service.setCharacteristic(C.ConfiguredName, part.name);
      this.occupancy?.addLinkedService(service);
    }
    const percent = life(part);
    const due = percent <= this.replaceAt;
    const before = this.parts.get(subtype);
    if (due && before !== undefined && before > this.replaceAt) {
      this.log.info(`${part.name}: ${part.subtitle ?? `${percent}% left`}; time to replace it.`);
    }
    this.parts.set(subtype, percent);
    service.updateCharacteristic(C.FilterLifeLevel, percent);
    service.updateCharacteristic(C.FilterChangeIndication,
      due ? C.FilterChangeIndication.CHANGE_FILTER : C.FilterChangeIndication.FILTER_OK);
  }

  /** Drop Filter Maintenance services whose part is no longer listed (or all, with an empty set). */
  removeParts(keep) {
    const { Service } = this.hap;
    for (const service of this.accessory.services.filter(s => s.UUID === Service.FilterMaintenance.UUID)) {
      if (!keep.has(service.subtype)) {
        this.occupancy?.removeLinkedService(service);
        this.accessory.removeService(service);
        this.parts.delete(service.subtype);
      }
    }
  }
}

/** Remaining life in percent, as the Narwal app's bar shows it. */
function life(part) {
  const used = Math.max(0, part.usage_duration ?? 0);
  return Math.max(0, Math.min(100, Math.round((part.total_duration - used) / part.total_duration * 100)));
}
