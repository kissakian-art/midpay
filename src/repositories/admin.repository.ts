import { eq, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { adminUsers, type AdminUser } from "../db/schema";

export class AdminRepository {
  constructor(private readonly db: Database) {}

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
}
