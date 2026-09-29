'use strict';

const express = require('express');
const c = require('../controllers/auth.controller');
const settings = require('../controllers/settings.controller');
const serviceCategory = require('../controllers/serviceCategory.controller');
const location = require('../controllers/location.controller');
const userType = require('../controllers/userType.controller');
const service = require('../controllers/service.controller');
const upload = require('../controllers/upload.controller');
const plan = require('../controllers/plan.controller');
const commissionSlot = require('../controllers/commissionSlot.controller');
const banner = require('../controllers/banner.controller');
const ticketDept = require('../controllers/ticketDept.controller');
const announcement = require('../controllers/announcement.controller');
const companyBank = require('../controllers/companyBank.controller');
const usersManager = require('../controllers/usersManager.controller');
const reports = require('../controllers/reports.controller');
const payoutBank = require('../controllers/payoutBank.controller');
const fundTransfer = require('../controllers/fundTransfer.controller');
const verify = require('../controllers/verify.controller');
const adminWallet = require('../controllers/adminWallet.controller');
const account = require('../controllers/account.controller');
const retailer = require('../controllers/retailer.controller');
const rsvc = require('../controllers/retailerServices.controller');
const ticket = require('../controllers/ticket.controller');
const network = require('../controllers/network.controller');
const fundRequest = require('../controllers/fundRequest.controller');
const kyc = require('../controllers/kyc.controller');
const ops = require('../controllers/operations.controller');
const { kycUpload } = require('../middleware/upload');
// Multer errors (wrong type / too big) come back as a 400 with a clear message.
const kycFile = (req, res, next) => kycUpload.single('image')(req, res, (e) => (e ? res.status(400).json({ error: e.code === 'LIMIT_FILE_SIZE' ? 'Photo must be 5 MB or smaller' : e.message, code: 'INVALID_FILE' }) : next()));
const { requireAuth, requireAdmin, requireManaged, requirePending } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const { uploadImage } = require('../middleware/upload');
const idempotency = require('../middleware/idempotency');

const router = express.Router();

// Public auth endpoints (rate-limited).
router.get('/auth/captcha', authLimiter, c.getCaptcha);
router.post('/auth/login', authLimiter, c.login);
router.post('/auth/verify-otp', authLimiter, requirePending, c.verifyOtp);
router.post('/auth/resend-otp', authLimiter, requirePending, c.resendOtp);

// Public settings for the login screen (banner image).
router.get('/settings/public', settings.getPublic);

// Protected endpoints (any authenticated user).
router.get('/me', requireAuth, c.me);
router.get('/menu', requireAuth, c.menu);

// Application / account settings (admin).
router.get('/settings/app', requireAdmin, settings.getApp);
router.post('/settings/app', requireAdmin, settings.saveApp);
router.post('/settings/login-banner', requireAdmin, uploadImage.single('banner'), settings.uploadLoginBanner);
router.delete('/settings/login-banner', requireAdmin, settings.clearLoginBanner);
router.post('/settings/theme', requireAdmin, settings.saveTheme);

// Modules → Service Categories (admin CRUD).
router.get('/service-categories', requireAdmin, serviceCategory.list);
router.post('/service-categories', requireAdmin, serviceCategory.create);
router.put('/service-categories/:id', requireAdmin, serviceCategory.update);
router.delete('/service-categories/:id', requireAdmin, serviceCategory.remove);

// Modules → City Master (states + cities). States list is reusable for dropdowns.
router.get('/states', requireAuth, location.listStates); // read-only master data (also used by the distributor panel)
router.get('/cities', requireAuth, location.listCities);
router.post('/cities', requireAdmin, location.createCity);
router.put('/cities/:id', requireAdmin, location.updateCity);
router.delete('/cities/:id', requireAdmin, location.removeCity);

// Modules → User Type Master (admin CRUD).
router.get('/user-types', requireAdmin, userType.list);
router.post('/user-types', requireAdmin, userType.create);
router.put('/user-types/:id', requireAdmin, userType.update);
router.delete('/user-types/:id', requireAdmin, userType.remove);

// Generic image upload -> { path } (used for service icons, etc.)
router.post('/uploads/image', requireAuth, uploadImage.single('image'), upload.uploadImage); // images only; also fund request payment proofs

// Modules → Service Master (admin CRUD; joins service category).
router.get('/services', requireAdmin, service.list);
router.post('/services', requireAdmin, service.create);
router.put('/services/:id', requireAdmin, service.update);
router.delete('/services/:id', requireAdmin, service.remove);

// Modules → Plan Master (admin CRUD; joins user type).
router.get('/plans', requireAdmin, plan.list);
router.post('/plans', requireAdmin, plan.create);
router.put('/plans/:id', requireAdmin, plan.update);
router.delete('/plans/:id', requireAdmin, plan.remove);

// Modules → Commission Slots (admin CRUD; joins user type, service, plan).
router.get('/commission-slots', requireAdmin, commissionSlot.list);
router.post('/commission-slots', requireAdmin, commissionSlot.create);
router.put('/commission-slots/:id', requireAdmin, commissionSlot.update);
router.delete('/commission-slots/:id', requireAdmin, commissionSlot.remove);

// Modules → Application Banners (admin CRUD).
router.get('/banners', requireAdmin, banner.list);
router.post('/banners', requireAdmin, banner.create);
router.put('/banners/:id', requireAdmin, banner.update);
router.delete('/banners/:id', requireAdmin, banner.remove);

// Modules → Ticket Departments (admin CRUD).
router.get('/ticket-departments', requireAdmin, ticketDept.list);
router.post('/ticket-departments', requireAdmin, ticketDept.create);
router.put('/ticket-departments/:id', requireAdmin, ticketDept.update);
router.delete('/ticket-departments/:id', requireAdmin, ticketDept.remove);

// Modules → Announcements (admin CRUD).
router.get('/announcements', requireAdmin, announcement.list);
router.get('/announcements/active', requireAdmin, announcement.active);
router.post('/announcements', requireAdmin, announcement.create);
router.put('/announcements/:id', requireAdmin, announcement.update);
router.delete('/announcements/:id', requireAdmin, announcement.remove);

// Banks master (dropdown for company bank).
router.get('/banks', requireAdmin, companyBank.listBanks);

// Company Banks (admin CRUD).
router.get('/company-banks', requireAdmin, companyBank.list);
router.post('/company-banks', requireAdmin, companyBank.create);
router.put('/company-banks/:id', requireAdmin, companyBank.update);
router.delete('/company-banks/:id', requireAdmin, companyBank.remove);

// Users Manager (managed portal users: retailers/distributors/etc.).
router.get('/module-options', requireAdmin, usersManager.moduleOptions);
router.get('/users', requireAdmin, usersManager.list);
router.post('/users', requireAdmin, usersManager.create);
router.put('/users/:id', requireAdmin, usersManager.update);
router.post('/users/:id/fund', requireAdmin, idempotency, usersManager.fund);
router.delete('/users/:id', requireAdmin, usersManager.remove);

// Reports + Fund Requests.
router.get('/account-history', requireAdmin, reports.accountHistory);
router.get('/service-report', requireAdmin, reports.serviceReport);
router.get('/fund-requests', requireAdmin, reports.fundRequests);
router.put('/fund-requests/:id', requireAdmin, idempotency, fundRequest.adminAct);
router.get('/gst-report', requireAdmin, reports.gstReport);
router.get('/tds-report', requireAdmin, reports.tdsReport);
router.get('/admin-margin-report', requireAdmin, reports.adminMarginReport);

// Commission Slab (read-only view of commission slots).
router.get('/commission-slab', requireAdmin, commissionSlot.slab);

// Aadhaar & PAN verification (sandbox KYC stubs).
router.post('/verify/pan', requireAdmin, verify.pan);
router.post('/verify/aadhaar', requireAdmin, verify.aadhaar);

// Admin Wallet (admin tops up / adjusts their own wallet) + history.
router.get('/admin-wallet/balance', requireAdmin, adminWallet.balance);
router.get('/admin-wallet', requireAdmin, adminWallet.list);
router.post('/admin-wallet/add', requireAdmin, idempotency, adminWallet.add);

// Account Settings → self-service (any authenticated user).
router.post('/account/change-password', requireAuth, account.changePassword);
router.post('/account/logout', requireAuth, account.logout);
router.post('/account/txn-pin', requireAuth, account.setTxnPin);

// Payout Banks (user payout accounts; admin approves/rejects; admin can add/edit + passbook).
router.get('/payout-banks', requireAdmin, payoutBank.list);
router.post('/payout-banks', requireAdmin, payoutBank.create);
router.put('/payout-banks/:id', requireAdmin, payoutBank.update);

// Fund Transfer (admin -> user wallet) + history.
router.get('/fund-transfer/lookup', requireAdmin, fundTransfer.lookup);
router.get('/fund-transfers', requireAdmin, fundTransfer.list);
router.post('/fund-transfers', requireAdmin, idempotency, fundTransfer.create);

// ── Retailer panel (managed users; owner-scoped) ──────────────────────────
router.get('/retailer/summary', requireManaged, retailer.summary);
router.get('/retailer/service-stats', requireManaged, retailer.serviceStats);
router.get('/services/catalogue', requireManaged, retailer.catalogue);
router.get('/operators', requireManaged, retailer.operators);
router.get('/retailer/account-history', requireManaged, retailer.accountHistory);
router.get('/retailer/service-report', requireManaged, retailer.serviceReport);
router.get('/retailer/gst-report', requireManaged, retailer.gstReport);
router.get('/retailer/tds-report', requireManaged, retailer.tdsReport);
router.get('/retailer/commission-report', requireManaged, retailer.commissionReport);
router.get('/retailer/my-commission-slab', requireManaged, retailer.myCommissionSlab);

// Recharge
router.get('/recharge/plans', requireManaged, rsvc.rechargePlans);
router.get('/recharge/dth-info', requireManaged, rsvc.dthInfo);
router.post('/recharge/mobile', requireManaged, idempotency, rsvc.rechargeMobile);
router.post('/recharge/dth', requireManaged, idempotency, rsvc.rechargeDth);

// BBPS / LIC / Gas / FASTag / Move To Bank
router.post('/bbps/fetch-bill', requireManaged, rsvc.bbpsFetch);
router.post('/bbps/pay', requireManaged, idempotency, rsvc.payBill);
router.post('/lic/pay', requireManaged, idempotency, rsvc.payLic);
router.post('/gas/pay', requireManaged, idempotency, rsvc.payGas);
router.post('/fastag/recharge', requireManaged, idempotency, rsvc.rechargeFastag);
router.post('/move-to-bank', requireManaged, idempotency, rsvc.moveToBank);

// AEPS / Aadhar Pay / Micro ATM
router.get('/aeps/devices', requireManaged, rsvc.aepsDevices);
router.post('/aeps/transact', requireManaged, idempotency, rsvc.aepsTransact);
router.post('/aadhar-pay/transact', requireManaged, idempotency, rsvc.aadharPay);
router.post('/micro-atm/transact', requireManaged, idempotency, rsvc.microAtm);

// DMT (money transfer)
router.post('/dmt/sender', requireManaged, rsvc.dmtSender);
router.get('/dmt/beneficiaries', requireManaged, rsvc.dmtBeneficiaries);
router.post('/dmt/beneficiary', requireManaged, rsvc.dmtBeneficiaryAdd);
router.post('/dmt/beneficiary/:id/verify', requireManaged, rsvc.dmtBeneficiaryVerify);
router.post('/dmt/transfer', requireManaged, idempotency, rsvc.dmtTransfer);

// Bookings
router.get('/booking/:type/search', requireManaged, rsvc.bookingSearch);
router.post('/booking/:type/book', requireManaged, idempotency, rsvc.bookingBook);

// Support Tickets — admin (all) + retailer (owner-scoped).
router.get('/tickets', requireAdmin, ticket.adminList);
router.get('/tickets/:id', requireAdmin, ticket.adminGet);
router.put('/tickets/:id', requireAdmin, ticket.adminUpdateStatus);
router.post('/tickets/:id/reply', requireAdmin, ticket.adminReply);

// Distributor / MD panel (own downline only).
router.get('/network/meta', requireManaged, network.requireNetwork, network.getMeta);
router.get('/network/users', requireManaged, network.requireNetwork, network.listUsers);
router.post('/network/users', requireManaged, network.requireNetwork, network.createUser);
router.put('/network/users/:id', requireManaged, network.requireNetwork, network.updateUser);
router.get('/network/lookup', requireManaged, network.requireNetwork, network.lookup);
router.post('/network/fund-transfer', requireManaged, network.requireNetwork, idempotency, network.fundTransfer);
router.get('/network/fund-transfers', requireManaged, network.requireNetwork, network.listTransfers);
router.get('/network/report', requireManaged, network.requireNetwork, network.report);
router.get('/network/fund-requests', requireManaged, network.requireNetwork, fundRequest.networkList);
router.put('/network/fund-requests/:id', requireManaged, network.requireNetwork, idempotency, fundRequest.networkAct);

// Fund requests raised by any managed user (retailer / distributor / MD); approved by their creator.
router.get('/my/fund-request/meta', requireManaged, fundRequest.myMeta);
router.get('/my/fund-requests', requireManaged, fundRequest.myList);
router.post('/my/fund-requests', requireManaged, idempotency, fundRequest.myCreate);

// KYC: users upload documents (private files), the admin reviews them.
router.post('/kyc/upload', requireManaged, kycFile, kyc.upload);
router.get('/kyc/files/:name', kyc.file); // signed short-lived link, checked in the controller
router.get('/my/kyc', requireManaged, kyc.mine);
router.post('/my/kyc', requireManaged, kyc.submit);
router.get('/kyc-requests', requireAdmin, kyc.adminList);
router.put('/kyc-requests/:id', requireAdmin, kyc.adminAct);

// Pending transactions, provider callback (HMAC-signed, no login) and reconciliation.
router.post('/provider-callback', ops.providerCallback);
router.get('/pending-transactions', requireAdmin, ops.listPending);
router.post('/pending-transactions/check', requireAdmin, ops.checkAll);
router.post('/pending-transactions/:id/check', requireAdmin, ops.checkOneTxn);
router.put('/pending-transactions/:id', requireAdmin, ops.settleByAdmin);
router.get('/reconciliation/runs', requireAdmin, ops.listRuns);
router.post('/reconciliation/runs', requireAdmin, ops.runNow);
router.get('/reconciliation/runs/:id/items', requireAdmin, ops.listItems);
router.put('/reconciliation/items/:id', requireAdmin, ops.resolveItem);

router.get('/retailer/tickets', requireManaged, ticket.retailerList);
router.get('/retailer/tickets/:id', requireManaged, ticket.retailerGet);
router.post('/retailer/tickets', requireManaged, ticket.retailerCreate);
router.post('/retailer/tickets/:id/reply', requireManaged, ticket.retailerReply);

module.exports = router;
