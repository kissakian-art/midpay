import { eq, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { adminUsers, type AdminUser } from "../db/schema";
import { selectRow } from "./financial.repository";

export class AdminRepository {
  constructor(private readonly db: Database) {}

  createInitial(row: { email: string; displayName?: string; passwordHash: string; role: AdminUser["role"] }): Promise<AdminUser | undefined> {
    const now = Math.floor(Date.now() / 1000);
    return this.db.insert(adminUsers).select(selectRow(adminUsers, {
      id: sql`${crypto.randomUUID()}`, email: sql`${row.email.trim().toLowerCase()}`, displayName: sql`${row.displayName ?? null}`,
      passwordHash: sql`${row.passwordHash}`, role: sql`${row.role}`, totpEnabled: sql`0`, status: sql`'active'`, createdAt: sql`${now}`, updatedAt: sql`${now}`,
    }, sql`where not exists (select 1 from ${adminUsers})`)).returning().get();
  }

  findById(id: string): Promise<AdminUser | undefined> {
    return this.db.select().from(adminUsers).where(eq(adminUsers.id, id)).get();
  }

  findByEmail(email: string): Promise<AdminUser | undefined> {
    return this.db.select().from(adminUsers).where(eq(adminUsers.email, email)).get();
  }

  async count(): Promise<number> {
    const row = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(adminUsers)
      .get();
    return row?.n ?? 0;
  }

  create(row: {
    email: string;
    displayName?: string;
    passwordHash: string;
    role: AdminUser["role"];
  }): Promise<AdminUser> {
    return this.db.insert(adminUsers).values(row).returning().get();
  }

  touchLogin(id: string, now: Date): Promise<unknown> {
    return this.db.update(adminUsers).set({ lastLoginAt: now }).where(eq(adminUsers.id, id)).run();
  }

  update(id: string, patch: Partial<AdminUser>): Promise<AdminUser | undefined> {
    return this.db.update(adminUsers).set(patch).where(eq(adminUsers.id, id)).returning().get();
  }
}
