// Narwal Freo error codes -> Matter RvcOperationalState ErrorState + Narwal's English message.
// Generated from Narwal's published error table v1.0.10 (en-US.json, the file the Narwal app
// downloads for the Freo). Codes not in this table (e.g. 0x01010072 during mop runs) are
// routine notices, not errors.

export const ERRORS = new Map([
  [0x01000020, [2, "The base station malfunctions. Please contact customer service."]], // UnableToCompleteOperation
  [0x01000021, [2, "Please confirm that the base station is powered on and the robot is inside the base, or if the robot still fails to start after being restarted, please contact customer service."]], // UnableToCompleteOperation
  [0x01010011, [2, "The base station malfunctions. Please contact customer service."]], // UnableToCompleteOperation
  [0x01010012, [2, "The base station malfunctions. Please contact customer service."]], // UnableToCompleteOperation
  [0x01010013, [2, "Dock overflow. Please treat by the help guide."]], // UnableToCompleteOperation
  [0x01010031, [2, "The base station malfunctions. Please contact customer service."]], // UnableToCompleteOperation
  [0x01010032, [2, "Cleaning base not in place. Please check if it is installed properly."]], // UnableToCompleteOperation
  [0x01010034, [69, "The clean water tank is not in place. Please put it in the base station."]], // WaterTankMissing
  [0x01010035, [68, "Water outlet error of the clean water tank. Please check if there's water in the tank. If yes, please check the troubleshooting brochure."]], // WaterTankEmpty
  [0x01010036, [74, "The dirty water tank is full or not in place. Please check."]], // DirtyWaterTankFull
  [0x01010050, [2, "Water control module is not detected. Please install it correctly."]], // UnableToCompleteOperation
  [0x01010051, [2, "Automatic Water Exchange module error. Please contact customer service."]], // UnableToCompleteOperation
  [0x01010052, [2, "Automatic Water Exchange module error. Please contact customer service."]], // UnableToCompleteOperation
  [0x01010053, [2, "Water overflow in the base station, please follow the help guide for handling"]], // UnableToCompleteOperation
  [0x01010054, [2, "Automatic Water Exchange module error. Please contact customer service."]], // UnableToCompleteOperation
  [0x01010059, [2, "Automatic water exchange module not installed. Please check the solution."]], // UnableToCompleteOperation
  [0x01010060, [2, "Water pump error. Please contact customer service"]], // UnableToCompleteOperation
  [0x01010061, [2, "Automatic Water Exchange module error. Please check the solution"]], // UnableToCompleteOperation
  [0x01010062, [2, "Automatic Water Exchange module error. Please contact customer service."]], // UnableToCompleteOperation
  [0x01010063, [2, "Automatic Water Exchange module error. Please contact customer service."]], // UnableToCompleteOperation
  [0x01010064, [2, "Automatic Water Exchange module error. Please contact customer service."]], // UnableToCompleteOperation
  [0x01010065, [2, "Automatic Water Exchange module error. Please contact customer service."]], // UnableToCompleteOperation
  [0x01010070, [2, "The detergent pump malfunctions. Please contact customer service."]], // UnableToCompleteOperation
  [0x01010090, [2, "The base station malfunctions. Please contact customer service."]], // UnableToCompleteOperation
  [0x01010091, [2, "The base station malfunctions. Please contact customer service."]], // UnableToCompleteOperation
  [0x01010092, [2, "The base station malfunctions. Please contact customer service."]], // UnableToCompleteOperation
  [0x01010093, [2, "The base station malfunctions. Please contact customer service."]], // UnableToCompleteOperation
  [0x02020011, [77, "An error occured when lifting the roller brush. Please check the roller brush."]], // BrushJammed
  [0x02020012, [77, "An error occured when lifting the roller brush. Please check the roller brush."]], // BrushJammed
  [0x02020013, [2, "The mop cannot be retracted, please check"]], // UnableToCompleteOperation
  [0x02020014, [2, "The mop cannot be extended, please check"]], // UnableToCompleteOperation
  [0x02020015, [2, "Failed to start cleaning. Please check the mop module"]], // UnableToCompleteOperation
  [0x02020028, [77, "The side brush error. Please clean or replace it."]], // BrushJammed
  [0x02020029, [77, "The side brush error. Please clean or replace it."]], // BrushJammed
  [0x02020030, [77, "The side brush error. Please clean or replace it."]], // BrushJammed
  [0x02020031, [77, "The roller brush gets tangled. Please check and clear it."]], // BrushJammed
  [0x02020032, [66, "Dust bin or dust bag not in place. Please check."]], // DustBinMissing
  [0x02020033, [2, "The robot malfunctions. Please contact customer service for help."]], // UnableToCompleteOperation
  [0x02020040, [2, "Mopping module error. Please check it"]], // UnableToCompleteOperation
  [0x02020041, [2, "Mopping module error. Please check it"]], // UnableToCompleteOperation
  [0x02020042, [2, "Mopping module error. Please check it"]], // UnableToCompleteOperation
  [0x02020050, [2, "Mopping module error. Please check"]], // UnableToCompleteOperation
  [0x02020051, [2, "Mopping module error. Please check"]], // UnableToCompleteOperation
  [0x02020052, [2, "Mopping module error. Please check"]], // UnableToCompleteOperation
  [0x02020060, [2, "Mopping module error. Please check it"]], // UnableToCompleteOperation
  [0x02020061, [2, "Mopping module error. Please check it"]], // UnableToCompleteOperation
  [0x02020062, [2, "Mopping module error. Please check it"]], // UnableToCompleteOperation
  [0x0202006E, [2, "The task was abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x0202006F, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02020070, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02020071, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02020072, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02020073, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02020074, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02020075, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02020076, [2, "Task interrupted abnormally, please restart the task"]], // UnableToCompleteOperation
  [0x02020077, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02020078, [2, "Radar anomaly, please contact customer service for assistance"]], // UnableToCompleteOperation
  [0x02030021, [2, "The battery malfunctions. Please contact customer service."]], // UnableToCompleteOperation
  [0x02030023, [2, "The battery malfunctions. Please contact customer service."]], // UnableToCompleteOperation
  [0x02030024, [2, "The battery malfunctions. Please contact customer service."]], // UnableToCompleteOperation
  [0x02030026, [2, "The battery malfunctions. Please contact customer service."]], // UnableToCompleteOperation
  [0x02030040, [2, "Battery temperature is too high. Please ensure that it is used at room temperature."]], // UnableToCompleteOperation
  [0x02030041, [2, "Battery temperature is too low. Please ensure that it is used at room temperature."]], // UnableToCompleteOperation
  [0x02030050, [2, "Robot charging error. Please check the base station power supply or wipe the charging contacts"]], // UnableToCompleteOperation
  [0x02030051, [2, "Robot charging error. Please move the robot to a room temperature environment."]], // UnableToCompleteOperation
  [0x02030052, [2, "Robot charging error. Please move the robot to a room temperature environment."]], // UnableToCompleteOperation
  [0x020F0000, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02100000, [2, "Robot system malfunction. Please restart the robot."]], // UnableToCompleteOperation
  [0x02100015, [64, "The robot can not return to the base station. Please clear the obstacles around the robot."]], // FailedToFindChargingDock
  [0x02100016, [2, "Clean the tires to prevent slipping; if the robot is in the docking station, check the charging contacts or contact customer service"]], // UnableToCompleteOperation
  [0x02100017, [64, "The robot fails to return to the base station. Please check it"]], // FailedToFindChargingDock
  [0x02100018, [64, "The robot can not find the base station. Please put the robot back to the base station and align it with the charging contacts."]], // FailedToFindChargingDock
  [0x02100019, [2, "Robot positioning failed. Please put the robot back into the base station"]], // UnableToCompleteOperation
  [0x02100020, [2, "Robot positioning failed. Please make sure the robot is placed on the correct map"]], // UnableToCompleteOperation
  [0x02100021, [65, "Robot is stuck, please move it to a new location to start"]], // Stuck
  [0x02100022, [65, "Robot is stuck - please restart in a new empty space"]], // Stuck
  [0x02100023, [65, "Robot is stuck - please restart in a new empty space"]], // Stuck
  [0x02100024, [65, "Robot is stuck - please restart in a new empty space"]], // Stuck
  [0x02100025, [65, "Robot is stuck - please restart in a new empty space"]], // Stuck
  [0x02100050, [1, "Exiting the base station. Please clear the obstacles around the robot."]], // UnableToStartOrResume
  [0x02100051, [1, "The robot can not exit the base station. Please clear the obstacles around the robot."]], // UnableToStartOrResume
  [0x02100052, [2, "Robot charging error. Please check the base station power supply or wipe the charging contacts"]], // UnableToCompleteOperation
  [0x02100060, [65, "Robot is stuck - please restart in a new empty space"]], // Stuck
  [0x02100061, [65, "Robot is stuck - please restart in a new empty space"]], // Stuck
  [0x02100062, [65, "Robot is stuck - please restart in a new empty space"]], // Stuck
  [0x02100063, [65, "Robot is stuck - please restart in a new empty space"]], // Stuck
  [0x02100070, [1, "The robot can not exit the base station. Please keep the floor in front of the base station flat and unobstructed."]], // UnableToStartOrResume
  [0x02100102, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02100103, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02100104, [2, "Task was interrupted abnormally, please restart the task"]], // UnableToCompleteOperation
  [0x02100105, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02100106, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02100107, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02100108, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02100109, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x0210010A, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x0210010B, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x0210010C, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x0210010D, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x0210010E, [2, "Task was abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x0210010F, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02100110, [2, "Narwal error"]], // UnableToCompleteOperation
  [0x02100111, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02100112, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02100113, [2, "Robot system error. Please restart the robot"]], // UnableToCompleteOperation
  [0x02100114, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02100115, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02100116, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02100117, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02100118, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02100119, [2, "Task interrupted abnormally, please restart the task"]], // UnableToCompleteOperation
  [0x0210011A, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x0210011B, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x0210011C, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x0210011D, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x0210011E, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x0210011F, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02100120, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02100121, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02100123, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02100124, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02100125, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02100126, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02100127, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02100128, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02100129, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x0210012A, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x0210012B, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x0210012C, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x0210012D, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x0210012E, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x0210012F, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02100130, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02100131, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02100132, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02100135, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02110000, [2, "Please check if the base station is powered on and if the robot is inside the base station. If the task fails to start repeatedly, please contact customer service"]], // UnableToCompleteOperation
  [0x02110001, [2, "Robot system malfunction. Please restart the robot."]], // UnableToCompleteOperation
  [0x02110020, [2, "Please check if the docking station is powered on. If it is properly powered, follow the help guide for further instructions"]], // UnableToCompleteOperation
  [0x02110030, [2, "Mop washing paused. Please wipe the robot charging contacts and put it back into the base station"]], // UnableToCompleteOperation
  [0x02110063, [2, "Please check if the base station is powered on, or disconnect the base station's power for 30 seconds and then reconnect it, and restart the robot"]], // UnableToCompleteOperation
  [0x02110064, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02110065, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02110066, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02110067, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02110068, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02110069, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x0211006A, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x0211006B, [2, "Task abnormally interrupted. Please restart the task"]], // UnableToCompleteOperation
  [0x0211006C, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x0211006D, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x0211006E, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x0211006F, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02110070, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02110071, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02110072, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02110073, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02110074, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02110075, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02110076, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02110077, [2, "Please restart the task. If the task fails to start repeatedly, please contact customer service"]], // UnableToCompleteOperation
  [0x02110078, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02110079, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x0211007A, [72, "The robot has low battery, please recharge it and try again"]], // LowBattery
  [0x0211007B, [2, "Narwal error"]], // UnableToCompleteOperation
  [0x0211007C, [2, "Task interrupted, please return the robot to the base station and try again"]], // UnableToCompleteOperation
  [0x0211007E, [67, "Task interrupted, please check the dust box or dust bag"]], // DustBinFull
  [0x0211007F, [2, "Task interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02110080, [2, "Task interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02110081, [2, "Task interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02110082, [2, "Task interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02110083, [2, "Task interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02110084, [2, "Task interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02110086, [2, "Task interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02110087, [2, "Task interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02110088, [2, "Task interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02110089, [2, "Task interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x0211008A, [2, "Task interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x0211008B, [2, "Task interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x0211008C, [2, "Task interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x0211008D, [2, "Task interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x0211008E, [2, "Task interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x0211008F, [2, "Task interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02110090, [2, "Task interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02110091, [2, "Task interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02110092, [2, "Task interrupted abnormally, please restart the task"]], // UnableToCompleteOperation
  [0x02110093, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02110094, [2, "Task abnormally interrupted. Please check if the base station power is connected and restart the robot"]], // UnableToCompleteOperation
  [0x02110095, [2, "Task abnormally interrupted. Please disconnect the base station power for 30 seconds, reconnect the power, and restart the robot"]], // UnableToCompleteOperation
  [0x02110098, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02110099, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x0211009A, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02130020, [65, "The robot is stray into No-Go Zones. Please restart it in an unobstructed location."]], // Stuck
  [0x02300000, [2, "Task terminated abnormally, please restart the task"]], // UnableToCompleteOperation
  [0x02300001, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02300002, [2, "Can not locate the robot. Please put it back into the base station."]], // UnableToCompleteOperation
  [0x02300003, [2, "Task interrupted abnormally, please restart the task"]], // UnableToCompleteOperation
  [0x02300004, [2, "Robot system error. Please restart the robot"]], // UnableToCompleteOperation
  [0x02300005, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x02310000, [2, "Sensor malfunctioned, please contact customer service."]], // UnableToCompleteOperation
  [0x02310025, [76, "The tire cannot rotate, please check the robot or the surrounding environment"]], // WheelsJammed
  [0x02310026, [76, "The wheel cannot rotate, please check the robot or the surrounding environment"]], // WheelsJammed
  [0x02310027, [76, "The wheel cannot rotate, please check the robot or the surrounding environment"]], // WheelsJammed
  [0x02310028, [76, "The tire cannot rotate, please check the robot or the surrounding environment"]], // WheelsJammed
  [0x02310031, [65, "The robot is suspended. Please restart it in an unobstructed location."]], // Stuck
  [0x02310100, [78, "The lidar malfunctions. Please check the troubleshooting brochure."]], // NavigationSensorObscured
  [0x02310101, [78, "The lidar malfunctions. Please check the troubleshooting brochure."]], // NavigationSensorObscured
  [0x02310102, [2, "The lidar malfunctions. Please contact customer service."]], // UnableToCompleteOperation
  [0x02310103, [2, "The lidar malfunctions. Please contact customer service."]], // UnableToCompleteOperation
  [0x02310104, [2, "The lidar malfunctions. Please contact customer service."]], // UnableToCompleteOperation
  [0x02310105, [2, "The lidar malfunctions. Please contact customer service."]], // UnableToCompleteOperation
  [0x02310106, [2, "The lidar malfunctions. Please contact customer service."]], // UnableToCompleteOperation
  [0x02310107, [2, "The lidar malfunctions. Please contact customer service."]], // UnableToCompleteOperation
  [0x02310110, [78, "Sensor malfunctions. Please check the troubleshooting brochure."]], // NavigationSensorObscured
  [0x02310111, [78, "Sensor malfunctions. Please check the troubleshooting brochure."]], // NavigationSensorObscured
  [0x02310120, [78, "Sensor malfunctions. Please check the troubleshooting brochure."]], // NavigationSensorObscured
  [0x02310128, [78, "Sensor malfunctions. Please check the troubleshooting brochure."]], // NavigationSensorObscured
  [0x02310129, [78, "Sensor malfunctions. Please check the troubleshooting brochure."]], // NavigationSensorObscured
  [0x02310130, [78, "Sensor malfunctions. Please check the troubleshooting brochure."]], // NavigationSensorObscured
  [0x02310138, [78, "Sensor malfunctions. Please check the troubleshooting brochure."]], // NavigationSensorObscured
  [0x02310140, [78, "The bumper malfunctions. Please check the troubleshooting brochure."]], // NavigationSensorObscured
  [0x02310201, [2, "Robot system error. Please restart the robot"]], // UnableToCompleteOperation
  [0x02310203, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
  [0x07000000, [2, "Task abnormally interrupted, please restart the task"]], // UnableToCompleteOperation
]);

/** Look up a Narwal code: { matter, message } or undefined when it isn't an error. */
export function lookupError(code) {
  const hit = ERRORS.get(Number(code));
  return hit ? { matter: hit[0], message: hit[1] } : undefined;
}
