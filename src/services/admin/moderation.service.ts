import type { LiveEvent, ModerationReport } from "../../db/schema";
import { AuditRepository } from "../../repositories/audit.repository";
import { ContentRepository } from "../../repositories/content.repository";
import { EntitlementRepository } from "../../repositories/entitlement.repository";
import { LiveRepository } from "../../repositories/live.repository";
import { ModerationRepository } from "../../repositories/moderation.repository";
import { badRequest, notFound } from "../errors";

const REPORT_TARGETS = ["content", "live_event", "comment", "user"] as const;
type ReportTarget = (typeof REPORT_TARGETS)[number];

/**
 * ModerationService — the reactive-safety toolkit for an open-signup platform
 * (§7.4): a user report queue, content takedown (reversible quarantine or hard
 * removal), and the live kill-switch. No pre-publish approval gate. Every admin
 * action is written to the immutable audit log (§7.1).
 */
export class ModerationService {
  constructor(
    private readonly reports: ModerationRepository,
    private readonly content: ContentRepository,
    private readonly entitlements: EntitlementRepository,
    private readonly live: LiveRepository,
    private readonly audit: AuditRepository,
  ) {}

  // --- User-facing ---
  async report(
    reporterUserId: string,
    input: { targetType: string; targetId: string; reason?: string },
  ): Promise<ModerationReport> {
    if (!REPORT_TARGETS.includes(input.targetType as ReportTarget)) {
      throw badRequest("bad_target_type", `targetType must be one of ${REPORT_TARGETS.join(", ")}`);
    }
    return this.reports.create({
      reporterUserId,
      targetType: input.targetType as ReportTarget,
      targetId: input.targetId,
      reason: input.reason,
      status: "open",
    });
  }

  // --- Admin: queue ---
  listReports(status?: ModerationReport["status"]): Promise<ModerationReport[]> {
    return this.reports.list(status);
  }

  async resolveReport(
    adminId: string,
    reportId: string,
    outcome: "actioned" | "dismissed",
  ): Promise<ModerationReport> {
    const report = await this.reports.findById(reportId);
    if (!report) throw notFound("report");
    const updated = await this.reports.update(reportId, {
      status: outcome,
      resolvedByAdminId: adminId,
      resolvedAt: new Date(),
    });
    await this.audit.record({
      adminId,
      action: `moderation.report.${outcome}`,
      targetType: "moderation_report",
      targetId: reportId,
    });
    return updated;
  }

  // --- Admin: content takedown ---
  /** Quarantine — reversible hide by moderation; buyers retain access. */
  async quarantineContent(adminId: string, contentId: string, reason?: string) {
    const item = await this.content.findById(contentId);
    if (!item || item.status === "deleted") throw notFound("content");
    const updated = await this.content.setStatus(contentId, "quarantined");
    await this.audit.record({
      adminId,
      action: "content.quarantine",
      targetType: "content",
      targetId: contentId,
      detail: { reason },
    });
    return updated;
  }

  /** Restore a quarantined item back to published. */
  async restoreContent(adminId: string, contentId: string) {
    const item = await this.content.findById(contentId);
    if (!item) throw notFound("content");
    if (item.status !== "quarantined") {
      throw badRequest("bad_state", `only quarantined content can be restored (is ${item.status})`);
    }
    const updated = await this.content.setStatus(contentId, "published");
    await this.audit.record({
      adminId,
      action: "content.restore",
      targetType: "content",
      targetId: contentId,
    });
    return updated;
  }

  /** Hard removal — media gone, buyer access revoked; ledger retained (§4.5.5). */
  async removeContent(adminId: string, contentId: string, reason?: string) {
    const item = await this.content.findById(contentId);
    if (!item || item.status === "deleted") throw notFound("content");
    const now = new Date();
    await this.entitlements.revokeForContent(contentId, now);
    const updated = await this.content.setStatus(contentId, "deleted", { deletedAt: now });
    await this.audit.record({
      adminId,
      action: "content.remove",
      targetType: "content",
      targetId: contentId,
      detail: { reason },
    });
    return updated;
  }

  // --- Admin: live kill-switch (§7.4) ---
  async killLive(adminId: string, liveId: string, reason?: string): Promise<LiveEvent> {
    const event = await this.live.findById(liveId);
    if (!event) throw notFound("live event");
    if (event.status !== "live" && event.status !== "scheduled") {
      throw badRequest("bad_state", `cannot kill a ${event.status} event`);
    }
    const updated = await this.live.setStatus(liveId, "terminated", { endedAt: new Date() });
    if (!updated) throw notFound("live event");
    await this.audit.record({
      adminId,
      action: "live.kill",
      targetType: "live_event",
      targetId: liveId,
      detail: { reason },
    });
    return updated;
  }
}
