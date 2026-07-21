import { AnalyticsRepository, type PaidTotals, type TypeBreakdown } from "../../repositories/analytics.repository";
import { ConfigService } from "../config.service";

export interface RevenueReport {
  totals: PaidTotals;
  byType: TypeBreakdown[];
  from: string | null;
  to: string | null;
}

export interface SelfFundingReport {
  platformEarningsUgx: number;
  monthlyTargetUgx: number;
  coveragePct: number;
  from: string | null;
  to: string | null;
}

/**
 * AnalyticsService — the revenue/sales dashboard and self-funding tracker
 * (§7.7). All figures come from the paid ledger; the platform's cut is
 * `platformShareUgx`.
 */
export class AnalyticsService {
  constructor(
    private readonly analytics: AnalyticsRepository,
    private readonly config: ConfigService,
  ) {}

  private toDate(sec?: number): Date | undefined {
    return sec ? new Date(sec * 1000) : undefined;
  }

  async revenue(fromSec?: number, toSec?: number): Promise<RevenueReport> {
    const from = this.toDate(fromSec);
    const to = this.toDate(toSec);
    const [totals, byType] = await Promise.all([
      this.analytics.paidTotals(from, to),
      this.analytics.byType(from, to),
    ]);
    return {
      totals,
      byType,
      from: from?.toISOString() ?? null,
      to: to?.toISOString() ?? null,
    };
  }

  async top(limit = 10) {
    const [topCreators, topContent] = await Promise.all([
      this.analytics.topCreators(limit),
      this.analytics.topContent(limit),
    ]);
    return { topCreators, topContent };
  }

  /**
   * Self-funding tracker (§6.3/§7.7): platform earnings for the window vs. the
   * monthly opex break-even target. `coveragePct` ≥ 100 means self-funding.
   */
  async selfFunding(fromSec?: number, toSec?: number): Promise<SelfFundingReport> {
    const from = this.toDate(fromSec);
    const to = this.toDate(toSec);
    const totals = await this.analytics.paidTotals(from, to);
    const target = await this.config.monthlyOpexTargetUgx();
    const coveragePct = target > 0 ? Math.round((totals.platformShareUgx / target) * 1000) / 10 : 0;
    return {
      platformEarningsUgx: totals.platformShareUgx,
      monthlyTargetUgx: target,
      coveragePct,
      from: from?.toISOString() ?? null,
      to: to?.toISOString() ?? null,
    };
  }
}
