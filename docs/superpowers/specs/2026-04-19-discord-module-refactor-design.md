# Discord Module Service Decomposition

## Problem

The discord module has two monolithic files that mix too many responsibilities:

- `discord-bot.service.ts` (949 lines): bot init, command registration, all event handlers, interaction routing, server setup, verify flow, sync-points, message moderation, reaction voting
- `discord.service.ts` (443 lines): notifications, XP system, role management, weekly chef check
- `fetchRoleIdByName` is duplicated in both services
- `commands/suggestion.ts` is dead code (never imported)
- Module exports all providers globally unnecessarily

## Approach

Service decomposition within a single NestJS module. Split the two monoliths into focused services by technical concern, keeping the existing command handler pattern (`handle()` method).

## Target File Structure

```
src/
├── app.module.ts                          (unchanged)
├── main.ts                                (unchanged)
├── ai/                                    (unchanged)
│   ├── ai.module.ts
│   └── ai.service.ts
├── prisma/                                (unchanged)
│   ├── prisma.module.ts
│   └── prisma.service.ts
└── discord/
    ├── discord.module.ts                  (updated imports/providers)
    ├── discord.gateway.ts                 (new — bot init + event routing)
    ├── services/
    │   ├── discord-notification.service.ts    (messaging + bounty notifications)
    │   ├── discord-xp.service.ts              (XP management)
    │   ├── discord-role.service.ts            (role sync + chef check)
    │   └── discord-guild.service.ts           (guild/channel utilities)
    ├── handlers/
    │   ├── discord-setup.service.ts           (server setup)
    │   └── discord-verify.service.ts          (verification flow)
    └── commands/
        ├── daily.ts                         (unchanged)
        ├── rank.ts                          (unchanged)
        ├── propose.ts                       (unchanged)
        ├── quest.ts                         (unchanged)
        ├── proposals.ts                     (unchanged)
        ├── leaderboard.ts                   (unchanged)
        └── onboarding.ts                    (unchanged)
```

## Service Interfaces

### discord.gateway.ts (~200 lines)

Extracted from discord-bot.service.ts. Owns the Discord.js `Client` instance.

**Responsibilities:**
- Bot client creation with intents
- `onModuleInit()`: register slash commands via REST API, login, set up event listeners
- Event routing (thin delegation layer):
  - `InteractionCreate` → `handleCommand()` / `handleButton()`
  - `MessageCreate` → channel enforcement + quest auto-complete
  - `MessageReactionAdd` → vote handling (inline, as it's tightly coupled to proposal DB queries)
  - `GuildMemberAdd` → logging
  - `clientReady` → verify channel setup + chef cron interval
- `handleSyncPoints()` — orchestration logic (stays here)
- `handleCheckChef()` — delegates to DiscordRoleService
- `handleNewMember()` — simple logging
- `setupVerifyChannel()` — delegates to onboarding command

**Injected dependencies:**
- `PrismaService`
- `DiscordNotificationService`
- `DiscordXpService`
- `DiscordRoleService`
- `DiscordGuildService`
- `DiscordSetupService`
- `DiscordVerifyService`
- All command classes (propose, daily, rank, quest, proposals, onboarding, leaderboard)

### services/discord-notification.service.ts (~120 lines)

Extracted from discord.service.ts. All Discord channel messaging.

**Public methods:**
- `sendMessage(content: string): Promise<void>` — plain text to configured channel
- `sendEmbed(title, description, fields, color): Promise<void>` — rich embed
- `notifyProjectCreated(projectName, category): void` — fire-and-forget
- `notifyBountyCreated(issueUrl, currencyAmount, creatorWallet): Promise<void>` — with AI summary
- `notifyBountyClaimed(bountyId, issueUrl, winnerWallet): void`
- `notifyBountyDisputed(bountyId, issueUrl, reason): void`
- `notifyBountyApproved(bountyId, issueUrl, winnerWallet): void`
- `notifyBountyToppedUp(bountyId, issueUrl, added, total): void`

**Injected dependencies:**
- `AiService` (for bounty created summary generation)

### services/discord-xp.service.ts (~50 lines)

Extracted from discord.service.ts. XP increment and user management.

**Public methods:**
- `addXp(discordId: string, amount: number): Promise<number>` — find/create user, increment XP, sync tier role
- `addXpByUserId(userId: number, amount: number): Promise<number>` — by internal ID
- `addProposalXp(proposerId: string): Promise<number>` — convenience: +25 XP
- `addVoteXp(userId: string): Promise<number>` — convenience: +2 XP

**Injected dependencies:**
- `PrismaService`
- `DiscordRoleService`

### services/discord-role.service.ts (~180 lines)

Extracted from both discord.service.ts and discord-bot.service.ts. Single source of truth for role operations.

**Public methods:**
- `syncTierRole(discordId: string, xp: number): Promise<void>` — determine tier, update Discord roles
- `assignScoutRole(discordId: string): Promise<void>` — add Scout role
- `checkWeeklyChef(): Promise<{ awarded: number; removed: number }>` — weekly chef role check
- `fetchRoleIdByName(roleName: string): Promise<string | null>` — single implementation (deduplicated)

**Constants:**
- `TIER_ROLES` array (moved from discord.service.ts)

**Injected dependencies:**
- `PrismaService`

### services/discord-guild.service.ts (~30 lines)

Extracted from discord-bot.service.ts. Client reference holder for guild operations.

**Public methods:**
- `setClient(client: Client): void` — called by gateway after login
- `fetchChannelIdByName(channelName: string): Promise<string | null>` — guild channel lookup

### handlers/discord-setup.service.ts (~200 lines)

Extracted from discord-bot.service.ts. Server structure creation.

**Public methods:**
- `handleSetupServer(interaction): Promise<void>` — creates roles, categories, channels, posts onboarding embed

**Injected dependencies:**
- `DiscordGuildService`
- `OnboardingCommand`

### handlers/discord-verify.service.ts (~140 lines)

Extracted from discord-bot.service.ts. User verification flow.

**Public methods:**
- `handleVerify(interaction): Promise<void>` — full verification flow (check GitHub link, mark onboarded, award XP, assign roles, post welcome)
- `checkOnboarded(discordId: string): Promise<boolean>` — simple DB lookup

**Injected dependencies:**
- `PrismaService`
- `DiscordXpService`
- `DiscordRoleService`
- `DiscordGuildService`

## Dependency Graph

```
discord.gateway
  ├──→ discord-notification
  │       └──→ ai
  ├──→ discord-xp
  │       └──→ discord-role
  │               └──→ prisma
  ├──→ discord-guild
  ├──→ discord-setup
  │       ├──→ discord-guild
  │       └──→ onboarding (command)
  ├──→ discord-verify
  │       ├──→ prisma
  │       ├──→ discord-xp
  │       ├──→ discord-role
  │       └──→ discord-guild
  └──→ all command classes
```

## Command Injection Changes

| Command | Before | After |
|---------|--------|-------|
| daily | PrismaService, DiscordService | PrismaService, DiscordXpService |
| quest | PrismaService, DiscordService | PrismaService, DiscordXpService |
| propose | PrismaService, DiscordService, AiService | PrismaService, DiscordXpService, DiscordRoleService, AiService |
| rank | PrismaService | PrismaService (unchanged) |
| leaderboard | PrismaService | PrismaService (unchanged) |
| proposals | PrismaService | PrismaService (unchanged) |
| onboarding | (none) | (none) (unchanged) |

## discord.module.ts

```typescript
@Global()
@Module({
  imports: [AiModule],
  providers: [
    DiscordGateway,
    DiscordNotificationService,
    DiscordXpService,
    DiscordRoleService,
    DiscordGuildService,
    DiscordSetupService,
    DiscordVerifyService,
    OnboardingCommand,
    RankCommand,
    DailyCommand,
    QuestCommand,
    ProposeCommand,
    ProposalsCommand,
    LeaderboardCommand,
  ],
  exports: [
    DiscordNotificationService,
    DiscordXpService,
  ],
})
export class DiscordModule {}
```

Only `DiscordNotificationService` and `DiscordXpService` are exported — these are the services used by other modules (e.g., the API server may call notification methods). Everything else is internal to the discord module.

## Migration Summary

### From discord.service.ts (443 lines)

| Content | Destination |
|---------|-------------|
| TIER_ROLES constant | discord-role.service.ts |
| onModuleInit, isConfigured | discord-notification.service.ts |
| sendMessage, sendEmbed | discord-notification.service.ts |
| notifyProjectCreated | discord-notification.service.ts |
| notifyBountyCreated/Claimed/Disputed/Approved/ToppedUp | discord-notification.service.ts |
| addXp, addXpByUserId | discord-xp.service.ts |
| syncTierRole | discord-role.service.ts |
| addProposalXp, addVoteXp | discord-xp.service.ts |
| assignScoutRole | discord-role.service.ts |
| checkWeeklyChef | discord-role.service.ts |
| fetchRoleIdByName | discord-role.service.ts |

### From discord-bot.service.ts (949 lines)

| Content | Destination |
|---------|-------------|
| Constructor, client setup | discord.gateway.ts |
| onModuleInit (command reg, login, events) | discord.gateway.ts |
| handleInteraction, handleCommand, handleButton | discord.gateway.ts |
| handleSyncPoints, handleReactionAdd, handleMessage | discord.gateway.ts |
| handleNewMember, setupVerifyChannel | discord.gateway.ts |
| handleVerify, checkOnboarded | handlers/discord-verify.service.ts |
| fetchRoleIdByName | DELETED (use DiscordRoleService) |
| fetchChannelIdByName | services/discord-guild.service.ts |
| handleSetupServer | handlers/discord-setup.service.ts |
| handleCheckChef | discord.gateway.ts |

### Dead code

- `commands/suggestion.ts` — DELETED (never imported)

## Verification

1. Run `npm run build` to verify compilation
2. Run the bot locally and test each slash command
3. Verify notification flow by triggering a test bounty creation
4. Verify XP/role sync by running `/daily` and checking role assignment
5. Verify server setup by running `/setup-server` in a test guild
6. Verify onboarding flow by clicking the Verify button
