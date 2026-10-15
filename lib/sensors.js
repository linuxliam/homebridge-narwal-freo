// Optional HomeKit (HAP) accessory next to the Matter vacuum: a "Cleaning" occupancy sensor
// (the Home app can't trigger automations on a robot vacuum's state) and each consumable's
// remaining life as a Filter Maintenance service.

const CONSUMABLE_POLL = 60 * 60 * 1000;
// The cloud's list catches up with a reset a moment after the robot accepts it.
const RESET_REFRESH = 10 * 1000;

export class FreoSensors {
  /**
   * @param {object} opts
   * @param {import('homebridge').API} opts.api
   * @param {import('homebridge').Logging} opts.log
   * @param {import('homebridge').PlatformAccessory} opts.accessory
   * @param {object} opts.device Narwal device record
   * @param {import('./cloud.js').NarwalCloud} opts.cloud
   * @param {import('./robot.js').NarwalRobot} opts.robot
   * @param {boolean} opts.cleaning add the Cleaning occupancy sensor
   * @param {boolean} opts.consumables add the consumables' Filter Maintenance services
   * @param {number} opts.replaceAt remaining life (%) at which a part shows "replace"
   * @param {string} opts.version plugin version
   */
  constructor({ api, log, accessory, device, cloud, robot, cleaning, consumables, replaceAt, version }) {
    this.log = log;
    this.hap = api.hap;
    this.accessory = accessory;
    this.device = device;
    this.cloud = cloud;
    this.robot = robot;
    this.replaceAt = replaceAt;
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
  }

  // ── Cleaning sensor ──

  /** Called with every robot status: occupied while the robot is in a cleaning job (dock visits included). */
  follow(active) {
    if (active === this.active) {
      return;
    }
    const finished = this.active && !active;
    this.active = active;
    const { OccupancyDetected } = this.hap.Characteristic;
    this.occupancy?.updateCharacteristic(OccupancyDetected,
      active ? OccupancyDetected.OCCUPANCY_DETECTED : OccupancyDetected.OCCUPANCY_NOT_DETECTED);
    if (finished && this.consumables) {
      this.pollConsumables();
    }
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
    if (!service.resetBound) {
      // Reset after replacing the part (shown by apps like Eve); same as the Narwal app's reset button.
      service.getCharacteristic(C.ResetFilterIndication).onSet(() => this.resetPart(part.type, part.name));
      service.resetBound = true;
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

  resetPart(type, name) {
    try {
      this.robot.resetConsumable(type);
    } catch {
      throw new this.hap.HapStatusError(this.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    this.log.info(`${name}: usage counter reset`);
    setTimeout(() => this.pollConsumables(), RESET_REFRESH);
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
