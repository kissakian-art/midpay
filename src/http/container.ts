import { createDb, type Database } from "../db/client";
import type { Env } from "../env";
import { AdminRepository } from "../repositories/admin.repository";
import { AnalyticsRepository } from "../repositories/analytics.repository";
import { AuditRepository } from "../repositories/audit.repository";
import { ConfigRepository } from "../repositories/config.repository";
import { ContentRepository } from "../repositories/content.repository";
import { CreatorRepository } from "../repositories/creator.repository";
import { EntitlementRepository } from "../repositories/entitlement.repository";
import { LiveRepository } from "../repositories/live.repository";
import { MessagingRepository } from "../repositories/messaging.repository";
import { ModerationRepository } from "../repositories/moderation.repository";
import { OtpRepository } from "../repositories/otp.repository";
import { PayoutRepository } from "../repositories/payout.repository";
import { SocialRepository } from "../repositories/social.repository";
import { TransactionRepository } from "../repositories/transaction.repository";
import { UserRepository } from "../repositories/user.repository";
import { WalletRepository } from "../repositories/wallet.repository";
import { AdminAuthService } from "../services/admin/admin-auth.service";
import { AnalyticsService } from "../services/admin/analytics.service";
import { ConfigAdminService } from "../services/admin/config-admin.service";
import { CreatorAdminService } from "../services/admin/creator-admin.service";
import { ModerationService } from "../services/admin/moderation.service";
import { AuthService } from "../services/auth.service";
import { ConfigService } from "../services/config.service";
import { ContentService } from "../services/content.service";
import { LiveService } from "../services/live.service";
import { MessagingService } from "../services/messaging.service";
import { SocialService } from "../services/social.service";
import { FlutterwaveClient } from "../services/payments/flutterwave";
import { PaymentsService } from "../services/payments/payments.service";
import { PayoutService } from "../services/payout.service";
import { ProfileService } from "../services/profile.service";
import { StorageService } from "../services/storage/storage.service";

/**
 * Container — composition root. Builds the repository + service graph from a
 * request's Env. Handlers pull services from here and never touch Drizzle/D1
 * directly, keeping the data layer isolated (§2.4 rule #4).
 */
export interface Container {
  db: Database;
  users: UserRepository;
  creators: CreatorRepository;
  auth: AuthService;
  content: ContentService;
  live: LiveService;
  payments: PaymentsService;
  payouts: PayoutService;
  adminAuth: AdminAuthService;
  moderation: ModerationService;
  creatorAdmin: CreatorAdminService;
  configAdmin: ConfigAdminService;
  analytics: AnalyticsService;
  social: SocialService;
  profile: ProfileService;
  messaging: MessagingService;
}

export function createContainer(env: Env): Container {
  const db = createDb(env.DB);

  const users = new UserRepository(db);
  const creators = new CreatorRepository(db);
  const otps = new OtpRepository(db);
  const contentRepo = new ContentRepository(db);
  const liveRepo = new LiveRepository(db);
  const transactions = new TransactionRepository(db);
  const entitlements = new EntitlementRepository(db);
  const wallets = new WalletRepository(db);
  const admins = new AdminRepository(db);
  const audit = new AuditRepository(db);
  const payoutRepo = new PayoutRepository(db);
  const moderationRepo = new ModerationRepository(db);
  const configRepo = new ConfigRepository(db);
  const analyticsRepo = new AnalyticsRepository(db);
  const socialRepo = new SocialRepository(db);
  const messagingRepo = new MessagingRepository(db);

  const config = new ConfigService(db, env);
  const flw = new FlutterwaveClient(env);
  const storage = new StorageService(env.MEDIA);

  const auth = new AuthService(users, otps, config, env);
  const content = new ContentService(contentRepo, creators, entitlements, config, storage);
  const live = new LiveService(liveRepo, creators, config);
  const payments = new PaymentsService(
    users,
    creators,
    contentRepo,
    liveRepo,
    transactions,
    entitlements,
    wallets,
    config,
    flw,
  );
  const payouts = new PayoutService(payoutRepo, wallets, creators, users, config, flw, audit);
  const adminAuth = new AdminAuthService(admins, audit, env);
  const moderation = new ModerationService(moderationRepo, contentRepo, entitlements, liveRepo, audit);
  const creatorAdmin = new CreatorAdminService(creators, audit);
  const configAdmin = new ConfigAdminService(configRepo, audit, env);
  const analytics = new AnalyticsService(analyticsRepo, config);
  const social = new SocialService(socialRepo, users, contentRepo, creators);
  const profile = new ProfileService(users, storage);
  const messaging = new MessagingService(messagingRepo, users);

  return {
    db,
    users,
    creators,
    auth,
    content,
    live,
    payments,
    payouts,
    adminAuth,
    moderation,
    creatorAdmin,
    configAdmin,
    analytics,
    social,
    messaging,
    profile,
  };
}
