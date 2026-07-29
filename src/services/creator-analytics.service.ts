import type { ContentRepository } from "../repositories/content.repository";
import type { CreatorRepository } from "../repositories/creator.repository";
import type { LiveRepository } from "../repositories/live.repository";
import type { TransactionRepository } from "../repositories/transaction.repository";
import type { WalletRepository } from "../repositories/wallet.repository";

export type AnalyticsRange = "day" | "week" | "all";

const DAY_MS = 86_400_000;

function rangeSince(range: AnalyticsRange): Date | undefined {
  if (range === "all") return undefined;
  const days = range === "day" ? 1 : 7;
  return new Date(Date.now() - days * DAY_MS);
}

/**
 * Creator-facing analytics (§7.7, creator view): "how am I doing" — earnings
 * over a window, per-post performance, and live-session reach. All read-only
 * aggregates over existing tables (transactions / wallet / content / live).
 */
export class CreatorAnalyticsService {
  constructor(
    private readonly creators: CreatorRepository,
    private readonly transactions: TransactionRepository,
    private readonly wallets: WalletRepository,
    private readonly content: ContentRepository,
    private readonly live: LiveRepository,
  ) {}

  async forUser(userId: string, range: AnalyticsRange) {
    const creator = await this.creators.findByUserId(userId);
    if (!creator) {
      // Not a creator yet (never posted/sold) — return an empty shape so the
      // app can render a clean "nothing yet" state.
      return {
        isCreator: false,
        range,
        earnings: { rangeUgx: 0, salesCount: 0, lifetimeUgx: 0, availableUgx: 0, heldUgx: 0 },
        totals: { posts: 0, likes: 0, comments: 0 },
        perPost: [],
        liveSessions: [],
      };
    }

    const since = rangeSince(range);
    const [earnings, wallet, posts, salesByContent, liveEvents] = await Promise.all([
      this.transactions.creatorEarnings(creator.id, since),
      this.wallets.findByCreatorId(creator.id),
      this.content.listPublishedByCreator(creator.id),
      this.transactions.creatorSalesByContent(creator.id, since),
      this.live.listByCreator(creator.id),
    ]);

    const salesMap = new Map(salesByContent.map((s) => [s.contentId, s]));
    const perPost = posts.map((p) => ({
      id: p.id,
      title: p.title,
      kind: p.kind,
      pricing: p.pricing,
      likes: p.likeCount,
      comments: p.commentCount,
      // Sales/earnings in the selected window (falls back to 0 when none).
      sales: salesMap.get(p.id)?.salesCount ?? 0,
      earningsUgx: salesMap.get(p.id)?.earningsUgx ?? 0,
    }));

    const liveSessions = liveEvents
      .filter((e) => {
        if (!since) return true;
        const when = e.startedAt ?? e.createdAt;
        return !!when && when >= since;
      })
      .map((e) => ({
        id: e.id,
        title: e.title,
        status: e.status,
        startedAt: e.startedAt,
        peakViewers: e.peakConcurrentViewers,
      }));

    return {
      isCreator: true,
      range,
      earnings: {
        rangeUgx: earnings.totalUgx,
        salesCount: earnings.salesCount,
        lifetimeUgx: wallet?.lifetimeEarnedUgx ?? 0,
        availableUgx: wallet?.balanceUgx ?? 0,
        heldUgx: wallet?.heldUgx ?? 0,
      },
      totals: {
        posts: posts.length,
        likes: posts.reduce((a, p) => a + p.likeCount, 0),
        comments: posts.reduce((a, p) => a + p.commentCount, 0),
      },
      perPost,
      liveSessions,
    };
  }
}
