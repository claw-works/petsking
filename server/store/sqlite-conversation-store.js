import { randomUUID } from 'node:crypto';

export class SqliteConversationStore {
  constructor(db) {
    this.db = db;
  }

  appendMessage(userId, petId, { role, content, action = null }) {
    this.db
      .query(
        `INSERT INTO messages (id, user_id, pet_id, role, content, action, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(randomUUID(), userId, petId, role, content, action, Date.now());
  }

  listMessages(userId, petId, limit = 50) {
    return this.db
      .query(
        `SELECT role, content, action, created_at FROM (
          SELECT role, content, action, created_at FROM messages WHERE user_id = ? AND pet_id = ? ORDER BY created_at DESC LIMIT ?
        ) ORDER BY created_at ASC`
      )
      .all(userId, petId, limit);
  }

  lastMessageAt(userId, petId) {
    const row = this.db
      .query(`SELECT MAX(created_at) as ts FROM messages WHERE user_id = ? AND pet_id = ?`)
      .get(userId, petId);
    return row && row.ts != null ? row.ts : null;
  }
}
