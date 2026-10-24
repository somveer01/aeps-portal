'use strict';

/**
 * The service names the retailer money endpoints send through the pipeline. Each must have a row in Service Master
 * (matched case-insensitively, with the aliases in serviceGuard): a name with no row is REFUSED (403
 * SERVICE_NOT_CONFIGURED) because nothing could then switch it off, limit it or check who may use it. They live here, once, so
 * the controllers and the startup / health check (`serviceGuard.missingNames`) read the same list.
 */
const NAMES = {
  MOBILE_RECHARGE: 'Mobile Recharge',
  DTH_RECHARGE: 'DTH Recharge',
  BILL_PAYMENT: 'Bill Payment',
  LIC_PAYMENT: 'LIC Payment',
  GAS_BOOKING: 'Gas Booking',
  FASTAG: 'FASTag',
  MOVE_TO_BANK: 'Move To Bank',
  AEPS: 'AEPS',
  AADHAR_PAY: 'Aadhar Pay',
  MICRO_ATM: 'Micro ATM',
  MONEY_TRANSFER: 'Money Transfer',
};
const BOOKING = { flight: 'Flight Booking', hotel: 'Hotel Booking', bus: 'Bus Booking' };

module.exports = { ...NAMES, BOOKING, ALL: [...Object.values(NAMES), ...Object.values(BOOKING)] };
