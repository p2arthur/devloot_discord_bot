import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  Client,
  Events,
  GatewayIntentBits,
  GuildMember,
  Message,
  MessageReaction,
  PartialMessageReaction,
  PartialUser,
  User,
} from 'discord.js';
import { DiscordGuildService } from './services/discord-guild.service';
import { DiscordSetupService } from './handlers/discord-setup.service';
import { DiscordCommandRegistryService } from './services/discord-command-registry.service';
import { DiscordInteractionRouterService } from './services/discord-interaction-router.service';
import { ProposalVoteService } from './services/proposal-vote.service';
import { ChannelModerationService } from './services/channel-moderation.service';
import { ChefSchedulerService } from './services/chef-scheduler.service';

@Injectable()
export class DiscordGateway implements OnModuleInit {
  private readonly logger = new Logger(DiscordGateway.name);
  private readonly client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
    ],
  });

  constructor(
    private readonly guildService: DiscordGuildService,
    private readonly setupService: DiscordSetupService,
    private readonly commandRegistry: DiscordCommandRegistryService,
    private readonly interactionRouter: DiscordInteractionRouterService,
    private readonly proposalVotes: ProposalVoteService,
    private readonly channelModeration: ChannelModerationService,
    private readonly chefScheduler: ChefSchedulerService,
  ) {}

  async onModuleInit(): Promise<void> {
    const token = process.env.DISCORD_BOT_TOKEN;
    const clientId = process.env.DISCORD_CLIENT_ID;
    const guildId = process.env.DISCORD_GUILD_ID;

    this.logConfig(token, clientId, guildId);
    if (!token || !clientId) {
      this.logger.warn(
        'DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID not set - bot is DISABLED',
      );
      return;
    }

    try {
      await this.commandRegistry.register(token, clientId, guildId);
    } catch (err) {
      this.logger.error(`Failed to register slash commands: ${err}`);
      return;
    }

    this.registerEventHandlers();

    this.logger.log('Calling client.login()...');
    try {
      await this.client.login(token);
      this.logger.log('client.login() resolved - waiting for clientReady');
    } catch (err) {
      this.logger.error(`client.login() FAILED: ${err}`);
    }
  }

  private registerEventHandlers(): void {
    this.client.on(Events.InteractionCreate, (interaction) => {
      void this.interactionRouter.handleInteraction(interaction);
    });
    this.client.on(Events.MessageCreate, (message: Message) => {
      void this.channelModeration.handleMessage(message);
    });
    this.client.on(
      Events.MessageReactionAdd,
      (
        reaction: MessageReaction | PartialMessageReaction,
        user: User | PartialUser,
      ) => void this.proposalVotes.handleReactionAdd(reaction, user),
    );
    this.client.on(Events.GuildMemberAdd, (member: GuildMember) => {
      this.handleNewMember(member);
    });
    this.client.on(Events.ClientReady, () => {
      void this.handleClientReady();
    });

    this.client.on(Events.Error, (err) => {
      this.logger.error(`Discord client error: ${err.message}`);
    });
    this.client.on(Events.Warn, (warning) => {
      this.logger.warn(`Discord client warning: ${warning}`);
    });
    this.client.on(Events.ShardDisconnect, (event, shardId) => {
      this.logger.warn(`Shard ${shardId} disconnected (code: ${event.code})`);
    });
    this.client.on(Events.ShardReconnecting, (shardId) => {
      this.logger.log(`Shard ${shardId} reconnecting...`);
    });
    this.client.on(Events.ShardResume, (shardId, replayedEvents) => {
      this.logger.log(
        `Shard ${shardId} resumed, replayed ${replayedEvents} events`,
      );
    });
  }

  private async handleClientReady(): Promise<void> {
    this.guildService.setClient(this.client);

    this.logger.log(
      `Discord bot CONNECTED as ${this.client.user?.tag} (ID: ${this.client.user?.id})`,
    );
    this.logger.log(`Bot is in ${this.client.guilds.cache.size} guild(s)`);

    for (const [id, guild] of this.client.guilds.cache) {
      this.logger.log(
        `  Guild: ${guild.name} (ID: ${id}, members: ${guild.memberCount})`,
      );
    }

    await this.setupService.ensureVerifyChannel(this.client);
    this.chefScheduler.start();
  }

  private handleNewMember(member: GuildMember): void {
    this.logger.log(
      `[member] New member joined: ${member.user.tag} (${member.user.id})`,
    );
  }

  private logConfig(
    token: string | undefined,
    clientId: string | undefined,
    guildId: string | undefined,
  ): void {
    this.logger.log(
      `Config check - token: ${token ? 'set' : 'MISSING'}, clientId: ${clientId ?? 'MISSING'}, guildId: ${guildId ?? 'MISSING (will use global)'}`,
    );
    this.logger.log(
      `Env - ROLE_NEWCOMER: ${process.env.ROLE_NEWCOMER ? 'set' : 'MISSING'}, ROLE_BUILDER: ${process.env.ROLE_BUILDER ? 'set' : 'MISSING'}, ROLE_HUNTER: ${process.env.ROLE_HUNTER ? 'set' : 'MISSING'}, ROLE_LEGEND: ${process.env.ROLE_LEGEND ? 'set' : 'MISSING'}`,
    );
    this.logger.log(
      `Env - CHANNEL_ID: ${process.env.DISCORD_BOUNTY_FEED_CHANNEL ?? 'MISSING'}, WELCOME_CHANNEL: ${process.env.DISCORD_WELCOME_CHANNEL ?? 'MISSING'}, ONBOARDED_ROLE_ID: ${process.env.DISCORD_ONBOARDED_ROLE_ID ?? 'MISSING'}, SCOUT_ROLE_ID: ${process.env.DISCORD_SCOUT_ROLE_ID ?? 'MISSING'}, SUGGESTIONS_CHANNEL_ID: ${process.env.DISCORD_BOUNTY_SUGGESTIONS_CHANNEL_ID ?? 'MISSING'}`,
    );
  }
}
