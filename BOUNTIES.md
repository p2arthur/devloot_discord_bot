# DevLoot Discord Bot — Community Bounties

DevLoot is building the open-source bounty marketplace on Algorand. Our Discord bot is the community engine — it handles onboarding, bounty proposals, XP/gamification, and live bounty notifications. But right now, it's functional but shallow. Onboarding is a single button click. The gateway is a 689-line monolith. There's no web API, no auto-threading, no skill profiling, and no way for users to find teammates.

These three bounties fix that. Each one is a self-contained piece of work that makes the bot genuinely better for the developers and funders who use DevLoot every day.

Contributing to these bounties directly helps DevLoot empower the open-source community. Every improvement to this bot makes it easier for developers to discover bounties, prove their skills, and get paid for shipping code that matters. By building these features, you're not just writing Discord bot code — you're helping grow the infrastructure that funds open source. If you've ever wanted to make a real impact on how open-source work gets funded, this is your chance.

---

Devloot Discord bot Bounty #1 — Gateway Refactor, Type Safety & Auto-Threading

## Bounty 1 — Gateway Refactor, Type Safety & Auto-Threading

### Scope

Architectural debt and missing infrastructure. The bot works, but `discord.gateway.ts` has regressed into a monolith (689 lines, 6+ responsibilities, file-level eslint-disable). Auto-threading was designed into the schema but never built. Interaction handlers use `any` everywhere.

### Reward

$40 USDC (testnet).

### Out of Scope

New features, onboarding changes, web API. Bounty 2 and 3 cover those.

### Details

#### 1a. Extract services from `discord.gateway.ts`

The gateway currently owns these distinct responsibilities that should become standalone injectable services:

| Responsibility                              | Current Location | Target Service                                     |
| ------------------------------------------- | ---------------- | -------------------------------------------------- |
| Proposal voting (reaction handling)         | Lines 438–537    | `ProposalVoteService`                              |
| Channel moderation (auto-delete + warnings) | Lines 539–608    | `ChannelModerationService`                         |
| XP sync from bounty activity                | Lines 377–436    | `XpSyncService` (or fold into `DiscordXpService`)  |
| Verify channel setup on boot                | Lines 627–668    | Move into `DiscordSetupService`                    |
| Weekly Chef cron                            | Lines 202–212    | `ChefSchedulerService` (or use `@nestjs/schedule`) |

After extraction, `discord.gateway.ts` should only contain:

- Discord.js client initialization
- Event listener wiring (`clientReady`, `interactionCreate`, `messageCreate`, `guildMemberAdd`)
- Thin routing to injected services

Target: **< 250 lines** in the gateway file.

#### 1b. Replace `any` types with proper Discord.js types

The gateway and all command handlers use `any` for interaction parameters. There are 16+ instances across the codebase:

```
src/discord/discord.gateway.ts:250          const cmd = interaction as any;
src/discord/discord.gateway.ts:270          private async handleCommand(interaction: any)
src/discord/discord.gateway.ts:368          private async handleButton(interaction: any)
src/discord/discord.gateway.ts:438          private async handleReactionAdd(reaction: any, user: any)
src/discord/discord.gateway.ts:611          private async handleNewMember(member: any)
src/discord/discord.gateway.ts:670          private async handleCheckChef(interaction: any)
src/discord/handlers/discord-verify.service.ts:24    async handleVerify(interaction: any)
src/discord/handlers/discord-setup.service.ts:12     async handleSetupServer(interaction: any, client: Client)
src/discord/commands/daily.ts:20            async handle(interaction: any)
src/discord/commands/rank.ts:9              async handle(interaction: any)
src/discord/commands/leaderboard.ts:9       async handle(interaction: any)
src/discord/commands/proposals.ts:9         async handle(interaction: any)
src/discord/commands/quest.ts:25            async handle(interaction: any)
src/discord/commands/propose.ts:30          async handle(interaction: any, ...)
src/discord/commands/onboarding.ts:45       async handle(interaction: any)
```

All handlers should use proper Discord.js types: `ChatInputCommandInteraction`, `ButtonInteraction`, `MessageReaction`, `User`, `GuildMember`, etc.

Remove the file-level eslint-disable comments from:

- `discord.gateway.ts` (lines 1–3)
- `discord-verify.service.ts` (lines 1–2)
- `daily.ts` (lines 1–3)

#### 1c. Auto-threading for #feed and #proposals

The `Proposal` model already has a `threadCreated Boolean @default(false)` field (`prisma/schema.prisma:213`) that is never used. Implement:

- When a proposal is posted to the suggestions channel (`propose.ts`, after line 300), automatically create a public thread on that message titled `[Proposal] <issue-title>`. Set `threadCreated = true` on the Proposal record.
- When a bounty notification is posted to #feed (`discord-notification.service.ts`, `notifyBountyCreated`), automatically create a public thread titled `Bounty — <issue-title>` so discussion can happen without cluttering the feed.
- Use the existing `threadCreated` field to prevent duplicate thread creation on retries.

#### 1d. Fix the stub user creation hack

In `src/discord/services/discord-xp.service.ts` (lines 26–36), when XP is awarded to a user not yet in the database, it creates a "stub" with a random negative `githubId`:

```typescript
const stubGithubId =
  -(Date.now() % 1_000_000_000) - Math.floor(Math.random() * 1000);
try {
  user = await this.prisma.user.create({
    data: { discordId: userId, githubId: stubGithubId, xp: amount },
  });
} catch {
  user = await this.prisma.user.create({
    data: { discordId: userId, githubId: stubGithubId - 1, xp: amount },
  });
}
```

This is fragile and violates the `githubId @unique` constraint intent. Replace with an `upsert` using `discordId` as the conflict target, or create a proper "pending" user flow that assigns a real `githubId` on onboarding.

### Acceptance Criteria

- [ ] `discord.gateway.ts` is under 250 lines
- [ ] Each extracted service is an injectable NestJS provider registered in `DiscordModule`
- [ ] Zero `any` types in interaction handlers (eslint-disable comments removed)
- [ ] `npm run lint` passes clean
- [ ] Proposals auto-create threads in the suggestions channel
- [ ] Bounty creation notifications auto-create threads in #feed
- [ ] `threadCreated` is set to `true` after thread creation
- [ ] Stub user creation is replaced with a safe upsert or pending-user flow
- [ ] All existing commands still work (manual test: `/daily`, `/rank`, `/propose`, `/onboarding`, `/leaderboard`, `/quests`, `/proposals`)

### Reporting

Open a PR with:

1. Description of changes
2. Before/after file structure
3. Lint output

### Rules

- First come first serve. Earliest PR on a duplicate fix wins.
- Qualifying PRs are at my discretion; all decisions are public.
- No deadline — program runs until formally closed.

---

Devloot Discord bot Bounty #2 — Deep Onboarding, Skill Profiling & Role Assignment

## Bounty 2 — Deep Onboarding, Skill Profiling & Role Assignment

### Scope

The onboarding is currently a single "Verify" button (`onboarding.ts`, 49 lines). Users click it, get 100 XP, and they're done. No skill collection, no intent profiling, no stack selection. This bounty transforms onboarding into a multi-step interactive flow that builds each user's DevLoot identity.

### Reward

$40 USDC (testnet).

### Out of Scope

Gateway refactor (Bounty 1), web API (Bounty 3).

### Details

#### 2a. Interactive onboarding with Select Menus

Replace the current onboarding embed (defined in `onboarding.ts` lines 12–43) with a multi-step flow:

**Step 1 — Intent Selection (Button/Select Menu):**
After clicking "Verify" (and linking GitHub), the user sees an embed asking:

> **What brings you to DevLoot?**
>
> - 🛡️ **Hunter** — I want to find and solve bounties
> - 💰 **Funder** — I want to fund open-source work
> - 👀 **Explorer** — I'm just checking things out

User selects one via a `StringSelectMenu`. Selection is stored.

**Step 2 — Stack Selection (Select Menu):**
After intent is selected, the embed updates (edit the original message) and shows:

> **What's your primary stack?** (select all that apply)

Options (multi-select `StringSelectMenu`):

- Rust
- TypeScript / JavaScript
- Python
- Solidity / Smart Contracts
- Algorand
- Solana
- Go
- Other

**Step 3 — GitHub Link + Verify:**
After stack is selected, the embed updates to show the existing "Link GitHub" button and "Verify" button. The verify flow proceeds as before but also assigns stack-based roles.

All steps should update the **same embed message** in-place (edit the message) to show visual progress:

```
[✓] Intent selected: Hunter
[✓] Stack selected: Rust, Algorand
[ ] GitHub linked
[ ] Verified
```

#### 2b. `UserPreferences` table

Add a new model to `prisma/schema.prisma`:

```prisma
model UserPreferences {
  id          Int      @id @default(autoincrement())
  userId      Int      @unique
  user        User     @relation(fields: [userId], references: [id])
  intent      String?  // "hunter", "funder", "explorer"
  stacks      String[] // ["rust", "algorand", "typescript"]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

Add the reverse relation on the `User` model:

```prisma
preferences UserPreferences?
```

Write and run the migration.

#### 2c. Stack-based role assignment

When onboarding completes (inside `discord-verify.service.ts` `handleVerify`), after assigning the "Verified" role:

1. Read the user's `stacks` from `UserPreferences`
2. For each stack, check if a Discord role named `Dev: <Stack>` exists (e.g., `Dev: Rust`, `Dev: Algorand`). Create it if it doesn't exist (using the Discord REST API, same pattern as `discord-role.service.ts`).
3. Assign the roles to the user.

Add a helper method `ensureAndAssignStackRoles(userId: string, stacks: string[])` to `discord-role.service.ts`.

#### 2d. Profile completion XP bonus

After both intent and stack are selected (before clicking Verify), award +50 XP as a "Profile Completion" bonus. This is in addition to the existing +100 XP onboarding bonus.

Add a new XP source to `discord-xp.service.ts`:

```typescript
async addProfileCompletionXp(userId: string) {
  return this.addXp(userId, 50);
}
```

#### 2e. Visual progress in the onboarding embed

The onboarding embed should be a live-updating message. Use Discord's message editing (`interaction.update()` or `message.edit()`) to update the embed as the user completes each step.

The embed footer or description should show a checklist that updates in real time, giving the user a clear sense of progress and what's left.

### Acceptance Criteria

- [ ] Onboarding flow has at least 2 interactive steps before the Verify button appears (Intent + Stack)
- [ ] `UserPreferences` model exists in Prisma schema with `intent` and `stacks` fields
- [ ] Migration runs cleanly (`npx prisma migrate dev`)
- [ ] Stack selection creates/assigns `Dev: <Stack>` Discord roles
- [ ] +50 XP is awarded for profile completion (intent + stack selected)
- [ ] Total onboarding XP is now +150 (50 profile + 100 verify)
- [ ] Onboarding embed updates in-place to show progress checklist
- [ ] Existing onboarding flow (GitHub link → Verify → role assignment) still works
- [ ] `npm run lint` passes clean
- [ ] Select menus use proper Discord.js v14 `StringSelectMenuBuilder`

### Reporting

Open a PR with:

1. Description of the new onboarding flow
2. Screenshots or recordings of the multi-step experience
3. Migration file for `UserPreferences`
4. Lint output

### Rules

- First come first serve. Earliest PR on a duplicate fix wins.
- Qualifying PRs are at my discretion; all decisions are public.
- No deadline — program runs until formally closed.

---

Devloot Discord bot Bounty #3 — REST API for Web Sync, Role-Based Pings & `/lfs` Command

## Bounty 3 — REST API for Web Sync, Role-Based Pings & `/lfs` Command

### Scope

The bot runs on port 3001 but exposes zero endpoints (`src/main.ts` boots NestJS with no controllers). Bounty notifications go to #feed but never ping relevant roles. There's no way for users to find teammates. This bounty wires the bot to the website, makes bounty notifications target the right people, and adds squad-building.

### Reward

$40 USDC (testnet).

### Out of Scope

Gateway refactor (Bounty 1), onboarding changes (Bounty 2).

### Details

#### 3a. REST API controllers

Create a new `src/api/` module with controllers that expose bot data to the DevLoot website:

**`UserController`** (`src/api/controllers/user.controller.ts`):

| Endpoint                          | Response                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| `GET /api/user/:discordId`        | User profile: XP, tier, streak, proposals count, `UserPreferences` (intent + stacks) |
| `GET /api/user/:discordId/quests` | Daily quest completion status                                                        |

**`LeaderboardController`** (`src/api/controllers/leaderboard.controller.ts`):

| Endpoint               | Response                                                 |
| ---------------------- | -------------------------------------------------------- |
| `GET /api/leaderboard` | Top 10 users by XP (same data as `/leaderboard` command) |

**`ProposalController`** (`src/api/controllers/proposal.controller.ts`):

| Endpoint             | Response                                                  |
| -------------------- | --------------------------------------------------------- |
| `GET /api/proposals` | Recent proposals with vote counts, AI summary, thread URL |

**`StatsController`** (`src/api/controllers/stats.controller.ts`):

| Endpoint         | Response                                                                  |
| ---------------- | ------------------------------------------------------------------------- |
| `GET /api/stats` | Aggregate: total users, total XP awarded, total proposals, active streaks |

Register the `ApiModule` in `app.module.ts`. All endpoints should use Prisma to query the database. No authentication required for read endpoints (the website is public-facing).

#### 3b. Role-based bounty pings

In `discord-notification.service.ts`, when `notifyBountyCreated` fires:

1. Parse the GitHub issue labels that are already fetched (lines 144–153):
   ```typescript
   const issueLabels = (issueRes.data.labels || []).map((l: any) =>
     typeof l === 'string' ? l : l.name,
   );
   ```
2. Map labels to Discord role mentions. Maintain a label-to-role config map:
   ```typescript
   const LABEL_ROLE_MAP: Record<string, string> = {
     rust: process.env.ROLE_DEV_RUST,
     typescript: process.env.ROLE_DEV_TYPESCRIPT,
     python: process.env.ROLE_DEV_PYTHON,
     algorand: process.env.ROLE_DEV_ALGORAND,
     'good first issue': process.env.ROLE_NEWCOMER,
   };
   ```
3. Build a mention string from matched labels: `<@&roleId1> <@&roleId2>`
4. Prepend the mention string to the bounty notification message so the relevant roles get pinged.

If no labels match, send the notification without pings (current behavior).

#### 3c. `/lfs` (Looking for Squad) command

Register a new slash command `/lfs` that lets users broadcast that they're looking for teammates:

**Command definition:**

```
/lfs [role_needed] [description]
  role_needed: string option (e.g., "frontend dev", "Rust engineer", "designer")
  description: string option (e.g., "Building an Algorand dApp, need a frontend dev")
```

**Behavior:**

1. Validate: user must be onboarded (same gate as other commands)
2. Create a rich embed posted in a new `#looking-for-squad` channel (created by `/setup-server` if it doesn't exist):
   ```
   🔍 Looking for Squad
   @username is looking for: **frontend dev**
   "Building an Algorand dApp, need a frontend dev"
   React with 🤝 to express interest
   ```
3. Auto-create a thread on the embed so interested users can discuss
4. Award +10 XP for posting (encourages collaboration)

**Channel addition:** Update `discord-setup.service.ts` to create a `#looking-for-squad` channel in the COMMUNITY category with the same permissions as `#general`.

#### 3d. Daily quest multiplier for verified hunters

If a user's `UserPreferences.intent` is `"hunter"`, their `/daily` base claim is boosted from +10 to +15 XP.

In `daily.ts`, after fetching the user, check their preferences:

```typescript
const prefs = await this.prisma.userPreferences.findUnique({
  where: { userId: user.id },
});
const baseXp = prefs?.intent === 'hunter' ? 15 : 10;
```

Update the `/daily` command embed to show the hunter bonus when applicable:

```
Daily Claim: +15 XP (Hunter bonus: +5)
Streak: 7 days (+12 XP)
Total: +27 XP
```

### Acceptance Criteria

- [ ] `GET /api/user/:discordId` returns user profile with XP, tier, and preferences
- [ ] `GET /api/leaderboard` returns top 10 users
- [ ] `GET /api/proposals` returns recent proposals with vote data
- [ ] `GET /api/stats` returns aggregate community stats
- [ ] All API endpoints return proper JSON with appropriate HTTP status codes
- [ ] Bounty notifications in #feed ping matching stack roles when GitHub labels match
- [ ] Label-to-role mapping is configurable via environment variables
- [ ] `/lfs` command is registered and functional
- [ ] `/lfs` posts to `#looking-for-squad` with an auto-created thread
- [ ] `/lfs` awards +10 XP
- [ ] `/setup-server` creates the `#looking-for-squad` channel
- [ ] Hunter intent gives +15 base daily XP instead of +10
- [ ] `/daily` embed shows Hunter bonus when applicable
- [ ] `npm run lint` passes clean
- [ ] API module is properly registered in `AppModule`

### Reporting

Open a PR with:

1. Description of new endpoints and their response shapes
2. Role ping logic explanation
3. `/lfs` command demo (screenshot or recording)
4. Lint output

### Rules

- First come first serve. Earliest PR on a duplicate fix wins.
- Qualifying PRs are at my discretion; all decisions are public.
- No deadline — program runs until formally closed.

---

## Getting Started

```bash
# Clone and install
git clone https://github.com/<org>/devloot_discord_bot.git
cd devloot_discord_bot
npm install

# Set up environment
cp .env.example .env
# Fill in DISCORD_BOT_TOKEN, DATABASE_URL, etc.

# Run migrations
npx prisma migrate dev

# Start in dev mode
npm run start:dev
```

The bot requires a Discord application with a bot token, a PostgreSQL database, a GitHub personal access token, and an OpenRouter API key. See `.env` for all required variables.

Each bounty is independent — you can work on any of them without needing to complete the others. Pick the one that matches your skills and submit a PR.
