'use strict';

const db = require('../config/db');

function joined() {
  return db('tickets as t')
    .join('users as u', 'u.id', 't.user_id')
    .join('ticket_departments as d', 'd.id', 't.department_id')
    .select(
      't.*', 'u.full_name as user_name', 'u.user_code', 'u.mobile as user_mobile',
      'd.name as department_name',
    );
}

module.exports = {
  // Admin: all tickets, filterable.
  async list({ status = null, departmentId = null, priority = null, userId = null, startDate = null, endDate = null, page = 1, pageSize = 10 } = {}) {
    const filter = (qb) => {
      if (status) qb.where('t.status', status);
      if (departmentId) qb.where('t.department_id', departmentId);
      if (priority) qb.where('t.priority', priority);
      if (userId) qb.where('t.user_id', userId);
      if (startDate) qb.whereRaw('t.created_at::date >= ?', [startDate]);
      if (endDate) qb.whereRaw('t.created_at::date <= ?', [endDate]);
    };
    const countRow = await db('tickets as t').where(filter).count('t.id as c').first();
    const rows = await joined().where(filter).orderBy('t.id', 'desc').limit(pageSize).offset((page - 1) * pageSize);
    return { rows, total: Number(countRow.c) };
  },

  // Retailer: only their own tickets.
  async listForUser({ userId, status = null, page = 1, pageSize = 10 }) {
    const filter = (qb) => { qb.where('t.user_id', userId); if (status) qb.where('t.status', status); };
    const countRow = await db('tickets as t').where(filter).count('t.id as c').first();
    const rows = await joined().where(filter).orderBy('t.id', 'desc').limit(pageSize).offset((page - 1) * pageSize);
    return { rows, total: Number(countRow.c) };
  },

  findById(id) { return joined().where('t.id', id).first(); },

  create({ userId, departmentId, subject, description, priority = 'medium' }) {
    const ticketNo = `TKT${Date.now().toString(36).toUpperCase()}`;
    return db('tickets').insert({
      ticket_no: ticketNo, user_id: userId, department_id: departmentId,
      subject, description, priority, status: 'open',
    }).returning('id').then((r) => (typeof r[0] === 'object' ? r[0].id : r[0]));
  },

  updateStatus(id, status) {
    return db('tickets').where({ id }).update({ status, updated_at: db.fn.now() });
  },

  // Replies (thread), oldest first.
  listReplies(ticketId) {
    return db('ticket_replies as r')
      .join('users as u', 'u.id', 'r.sender_id')
      .where('r.ticket_id', ticketId)
      .select('r.*', 'u.full_name as sender_name')
      .orderBy('r.id', 'asc');
  },

  async addReply({ ticketId, senderId, senderRole, message }) {
    const [row] = await db('ticket_replies').insert({ ticket_id: ticketId, sender_id: senderId, sender_role: senderRole, message }).returning('id');
    await db('tickets').where({ id: ticketId }).update({ updated_at: db.fn.now() });
    return typeof row === 'object' ? row.id : row;
  },
};
