// In-memory stand-ins for Infisical and Postgres, with the rules that matter:
// passwords are checked against SCRAM verifiers, and a login may only change
// its own password.
const { matchesVerifier, scramVerifier } = require('../scram');

class FakeSecrets {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
    this.writes = [];
  }

  async get(path, name) {
    return this.values.get(`${path}:${name}`) ?? null;
  }

  async set(path, name, value) {
    this.writes.push(`${path}:${name}`);
    this.values.set(`${path}:${name}`, value);
  }

  value(path, name) {
    return this.values.get(`${path}:${name}`) ?? null;
  }
}

class FakeDatabase {
  constructor() {
    this.verifiers = new Map(); // role -> SCRAM verifier
    this.sessions = new Map(); // role -> open connections of others
    this.statements = [];
    this.poolerLag = 0; // after a password change, refuse that many logins, like a pooler that has not noticed yet
    this.lagging = new Map();
  }

  addRole(role, password) {
    this.verifiers.set(role, password ? scramVerifier(password) : null);
  }

  logsIn(url) {
    const { role, password } = parse(url);
    const verifier = this.verifiers.get(role);
    return Boolean(verifier && matchesVerifier(password, verifier));
  }

  /** `connect` for the code under test. */
  connect = async (url) => {
    const { role } = parse(url);
    if (!this.logsIn(url)) throw new Error(`password authentication failed for user "${role}"`);
    if ((this.lagging.get(role) ?? 0) > 0) {
      this.lagging.set(role, this.lagging.get(role) - 1);
      throw new Error('pooler still has the old password');
    }
    return this.clientFor(role);
  };

  clientFor(role, { admin = false } = {}) {
    const db = this;
    return {
      async query(sql, params) {
        db.statements.push(sql);
        if (sql.includes('pg_stat_activity')) return { rows: [{ sessions: db.sessions.get(params[0]) ?? 0 }] };
        if (sql.includes('FROM pg_roles')) return { rows: params[0].filter((r) => db.verifiers.has(r)).map((rolname) => ({ rolname })) };
        if (sql === 'SELECT 1') return { rows: [{ '?column?': 1 }] };
        const alter = /^ALTER ROLE "([a-z0-9_]+)" PASSWORD '(SCRAM-SHA-256\$[^']+)'$/.exec(sql);
        if (alter) {
          if (!admin && alter[1] !== role) throw new Error(`permission denied to alter role ${alter[1]}`);
          db.verifiers.set(alter[1], alter[2]);
          db.lagging.set(alter[1], db.poolerLag);
          return { rows: [] };
        }
        throw new Error(`unexpected SQL: ${sql}`);
      },
      async end() {},
    };
  }
}

function parse(url) {
  const parsed = new URL(url);
  return {
    role: decodeURIComponent(parsed.username).split('.')[0],
    password: decodeURIComponent(parsed.password),
  };
}

const noWait = async () => undefined;

module.exports = { FakeSecrets, FakeDatabase, noWait };
