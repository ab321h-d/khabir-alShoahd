import { int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const schools = mysqlTable("schools", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 180 }).notNull(),
  joinCode: varchar("joinCode", { length: 16 }).notNull().unique(),
  createdByUserId: int("createdByUserId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const schoolMemberships = mysqlTable("schoolMemberships", {
  id: int("id").autoincrement().primaryKey(),
  schoolId: int("schoolId").notNull(),
  userId: int("userId").notNull(),
  memberRole: mysqlEnum("memberRole", ["director", "teacher"]).notNull(),
  joinedAt: timestamp("joinedAt").defaultNow().notNull(),
}, (table) => [uniqueIndex("school_member_unique").on(table.schoolId, table.userId)]);

export const performanceSubmissions = mysqlTable("performanceSubmissions", {
  id: int("id").autoincrement().primaryKey(),
  schoolId: int("schoolId").notNull(),
  teacherUserId: int("teacherUserId").notNull(),
  teacherName: varchar("teacherName", { length: 180 }).notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  note: text("note"),
  fileKey: varchar("fileKey", { length: 512 }).notNull(),
  fileUrl: varchar("fileUrl", { length: 768 }).notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  fileSize: int("fileSize").notNull(),
  status: mysqlEnum("status", ["received", "reviewed"]).default("received").notNull(),
  submittedAt: timestamp("submittedAt").defaultNow().notNull(),
  reviewedAt: timestamp("reviewedAt"),
});

export type School = typeof schools.$inferSelect;
export type SchoolMembership = typeof schoolMemberships.$inferSelect;
export type PerformanceSubmission = typeof performanceSubmissions.$inferSelect;
