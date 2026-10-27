'use strict';

const { buildOverview } = require('../services/commissionOverview.service');
const { toAmount } = require('../utils/money');

// Commission Overview (admin, read only). The work is in services/commissionOverview.service.js; this only checks the query.
//   GET /api/commission-overview?amount=1000&typeId=<type that did the sale>&plans=<typeId>:<planId>,...   (by type)
//   GET /api/commission-overview?amount=1000&userId=<user>                                                  (by user: his real chain)
const SAMPLE = 1000;
const MAX_AMOUNT = 10000000;

async function overview(req, res, next) {
  try {
    const amount = req.query.amount === undefined || req.query.amount === '' ? SAMPLE : toAmount(req.query.amount);
    if (!(amount > 0) || amount > MAX_AMOUNT) return res.status(400).json({ error: 'Enter a sample amount (up to 2 decimals, at most 1,00,00,000)', code: 'INVALID_AMOUNT' });
    const rawUser = req.query.userId;
    const userId = rawUser === undefined || rawUser === '' ? null : parseInt(rawUser, 10);
    if (rawUser !== undefined && rawUser !== '' && (!/^\d{1,9}$/.test(String(rawUser)) || !userId)) return res.status(400).json({ error: 'Choose a valid user', code: 'INVALID_USER' });
    const result = await buildOverview({ amount, typeId: parseInt(req.query.typeId, 10), plansParam: req.query.plans, userId });
    if (result.error) return res.status(result.status || 400).json({ error: result.error, code: result.code });
    return res.json(result);
  } catch (e) { return next(e); }
}

module.exports = { overview };
