import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema.ts";

class BoundStatement {
  constructor(database, sql, params = []) {
    this.database = database;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new BoundStatement(this.database, this.sql, params);
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.params) };
  }

  async raw() {
    const rows = this.database.prepare(this.sql).all(...this.params);
    return rows.map((row) => Object.values(row));
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.params);
    return { success: true, results: [], meta: { changes: Number(result.changes) } };
  }
}

class TestD1Database {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new BoundStatement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

export function createTestDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const migration of ["0000_silent_hulk.sql", "0001_ambitious_master_chief.sql", "0002_yielding_doctor_spectrum.sql", "0003_tan_wrecker.sql", "0004_remove_jackie_household.sql", "0005_goofy_the_santerians.sql"]) {
    sqlite.exec(readFileSync(new URL(`../drizzle/${migration}`, import.meta.url), "utf8"));
  }
  const d1 = new TestD1Database(sqlite);
  return { db: drizzle(d1, { schema }), d1, sqlite };
}
