import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { users, type NewUser, type User } from "../db/schema";

export class UserRepository {
  constructor(private readonly db: Database) {}

  findById(id: string): Promise<User | undefined> {
    return this.db.select().from(users).where(eq(users.id, id)).get();
  }

  findByPhone(phone: string): Promise<User | undefined> {
    return this.db.select().from(users).where(eq(users.phone, phone)).get();
  }

  /** Handles are stored lowercased, so this is a case-insensitive lookup. */
  findByHandle(handle: string): Promise<User | undefined> {
    return this.db.select().from(users).where(eq(users.handle, handle.toLowerCase())).get();
  }

  create(row: NewUser): Promise<User> {
    return this.db.insert(users).values(row).returning().get();
  }

  update(id: string, patch: Partial<User>): Promise<User | undefined> {
    return this.db.update(users).set(patch).where(eq(users.id, id)).returning().get();
  }
}
