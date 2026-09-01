import { randomUUID } from 'node:crypto';

export function createUserStore(db) {
  return {
    findByEmail(email) {
      const result = db.query(`SELECT * FROM users WHERE email = ?`).get(email);
      return result === null ? undefined : result;
    },
    create(email, passwordHash) {
      const id = randomUUID();
      db.query(
        `INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)`
      ).run(id, email, passwordHash, Date.now());
      return { id, email };
    },
  };
}
