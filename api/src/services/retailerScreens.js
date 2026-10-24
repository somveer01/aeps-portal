'use strict';

/**
 * The built-in RETAILER screens a service from Service Master can open (services.screen). The screens themselves are app code;
 * Service Master decides WHICH services use which screen. A service with an empty screen has no retailer tile. One screen can serve
 * several services (e.g. a second Mobile Recharge service with its own commission / API / limit): the tile passes the service code
 * and the endpoint checks that the service's screen matches.
 *
 *   label          default tile title (the service's own title is used when it has one)
 *   group          'b2b' | 'online' - the tab the tile is in
 *   icon           menu / tile icon name (components/Icon.js)
 *   operatorGroup  which `operators.service` group the screen lists (Operator Master), when it has operators
 *   operatorCategory  narrows that group (LIC = Insurance bills)
 */
const SCREENS = {
  'mobile-recharge': { label: 'Mobile Recharge', group: 'b2b', icon: 'phone', operatorGroup: 'mobile' },
  'dth-recharge': { label: 'DTH Recharge', group: 'b2b', icon: 'phone', operatorGroup: 'dth' },
  'bill-payment': { label: 'Bill Payment', group: 'b2b', icon: 'receipt', operatorGroup: 'bbps' },
  'lic-payment': { label: 'LIC Payment', group: 'b2b', icon: 'receipt', operatorGroup: 'bbps', operatorCategory: 'Insurance' },
  'gas-booking': { label: 'Gas Booking', group: 'b2b', icon: 'cash', operatorGroup: 'gas' },
  fastag: { label: 'FASTag Recharge', group: 'b2b', icon: 'cash', operatorGroup: 'fastag' },
  'move-to-bank': { label: 'Move To Bank', group: 'b2b', icon: 'bank' },
  aeps: { label: 'AEPS', group: 'b2b', icon: 'verify' },
  'aadhar-pay': { label: 'Aadhar Pay', group: 'b2b', icon: 'verify' },
  'micro-atm': { label: 'Micro ATM', group: 'b2b', icon: 'atm' },
  'money-transfer': { label: 'Money Transfer', group: 'b2b', icon: 'transfer' },
  flight: { label: 'Flight Booking', group: 'online', icon: 'send' },
  hotel: { label: 'Hotel Booking', group: 'online', icon: 'grid' },
  bus: { label: 'Bus Booking', group: 'online', icon: 'transfer' },
};

const keys = () => Object.keys(SCREENS);
const list = () => keys().map((key) => ({ key, ...SCREENS[key] }));

module.exports = { SCREENS, keys, list };
