'use strict';

const db = require('../config/db');
const { applyGridFilters, applyGridSortFirst, DATE_COL } = require('../utils/gridQuery');

// Sortable / filterable columns of the ticket grids (keys = the app's DataGrid column keys).
const GRID = {
  ticket_no: 't.ticket_no', user: { sort: 'u.full_name', filter: "concat_ws(' ', u.full_name, u.user_code)" }, subject: 't.subject',
  department: 'd.name', priority: 't.priority', status: 't.status', created_at: DATE_COL('t.created_at'),
};
// Count with the same joins the grid filters use.
const counted = () => db('tickets as t').join('users as u', 'u.id', 't.user_id').join('ticket_departments as d', 'd.id', 't.department_id');

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
  GRID,
  // Admin: all tickets, filterable.
  async list({ status = null, departmentId = null, priority = null, userId = null, startDate = null, endDate = null, grid = null, page = 1, pageSize = 10 } = {}) {
    const filter = (qb) => {
      if (status) qb.where('t.status', status);
      if (departmentId) qb.where('t.department_id', departmentId);
      if (priority) qb.where('t.priority', priority);
      if (userId) qb.where('t.user_id', userId);
      if (startDate) qb.whereRaw('t.created_at::date >= ?', [startDate]);
      if (endDate) qb.whereRaw('t.created_at::date <= ?', [endDate]);
      applyGridFilters(qb, grid);
    };
    const countRow = await counted().where(filter).count('t.id as c').first();
    const rows = await joined().where(filter).modify((qb) => applyGridSortFirst(qb, grid)).orderBy('t.id', 'desc').limit(pageSize).offset((page - 1) * pageSize);
    return { rows, total: Number(countRow.c) };
  },

  // Retailer: only their own tickets.
  async listForUser({ userId, status = null, grid = null, page = 1, pageSize = 10 }) {
    const filter = (qb) => { qb.where('t.user_id', userId); if (status) qb.where('t.status', status); applyGridFilters(qb, grid); };
    const countRow = await counted().where(filter).count('t.id as c').first();
    const rows = await joined().where(filter).modify((qb) => applyGridSortFirst(qb, grid)).orderBy('t.id', 'desc').limit(pageSize).offset((page - 1) * pageSize);
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
