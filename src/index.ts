import {
  registerMonitoringHandlers,
  tryHandleMonitorLinkInput,
} from 'bot/monitoring-handlers';
import { IContextBot } from 'config/context-interface';
import { BOT_ADMIN_ID, BOT_TOKEN } from 'config/env-config';
import { initUserbot, runUserbotLoginAndExit } from 'config/userbot';
import { startMonitoringScheduler } from 'services/monitoring-scheduler';
import { newTaskReceived } from 'services/stories-service';
import { session, Telegraf } from 'telegraf';
import { callbackQuery, message } from 'telegraf/filters';

export const bot = new Telegraf<IContextBot>(BOT_TOKEN);
const RESTART_COMMAND = 'restart';

/** Только вход userbot (Telegram код/пароль) и завершение — без Telegram Bot API long polling */
const USERBOT_LOGIN_ONLY =
  process.env.USERBOT_LOGIN_ONLY === 'true' ||
  process.env.USERBOT_LOGIN_ONLY === '1';

bot.use(session());
registerMonitoringHandlers(bot);

bot.catch((error) => {
  console.error(error, 'INDEX.TS');
});

// FIXME: set any due to buildtime error
const extraOptions: any = {
  link_preview_options: {
    is_disabled: true,
  },
};
bot.start(async (ctx) => {
  await ctx.reply(
    '🔗 Please send 1 of the next options:\n\n' +
      "username (with '@' symbol):\n@chupapee\n\n" +
      "or phone number (with '+' symbol):\n+71234567890\n\n" +
      'or the direct link to story:\nhttps://t.me/durov/s/1\n\n' +
      '📎 Фоновый мониторинг и история: /monitor',
    extraOptions
  );
});

bot.on(message('text'), async (ctx) => {
  const handleMessage = async () => {
    const text = ctx.message.text;

    const monitorHandled = await tryHandleMonitorLinkInput(ctx, text);
    if (monitorHandled) {
      return;
    }

    // username
    if (text.startsWith('@') || text.startsWith('+')) {
      newTaskReceived({
        chatId: String(ctx.chat.id),
        link: text,
        linkType: 'username',
        locale: '',
        user: ctx.from,
        initTime: Date.now(),
      });
      return;
    }

    // particular story link
    if (text.startsWith('https') || text.startsWith('t.me/')) {
      const paths = text.split('/');
      if (
        !Number.isNaN(Number(paths.at(-1))) &&
        paths.at(-2) === 's' &&
        paths.at(-3)
      ) {
        newTaskReceived({
          chatId: String(ctx.chat.id),
          link: text,
          linkType: 'link',
          locale: '',
          user: ctx.from,
          initTime: Date.now(),
        });
        return;
      }
    }

    // restart action
    if (ctx.from.id === BOT_ADMIN_ID && ctx.message.text === RESTART_COMMAND) {
      ctx.reply('Are you sure?', {
        reply_markup: {
          inline_keyboard: [[{ text: 'Yes', callback_data: RESTART_COMMAND }]],
        },
      });
      return;
    }

    await ctx.reply(
      '🚫 Please send a valid link to user (username or phone number)'
    );
  };

  handleMessage();
});

bot.on(callbackQuery('data'), async (ctx) => {
  // handle pinned stories pagination
  if (ctx.callbackQuery.data.includes('&')) {
    const [username, nextStoriesIds] = ctx.callbackQuery.data.split('&');

    newTaskReceived({
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      chatId: String(ctx?.from?.id),
      link: username,
      linkType: 'username',
      nextStoriesIds: nextStoriesIds ? JSON.parse(nextStoriesIds) : undefined,
      locale: '',
      user: ctx.from,
      initTime: Date.now(),
    });
  }

  // restart action
  if (
    ctx.callbackQuery.data === RESTART_COMMAND &&
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    ctx?.from?.id === BOT_ADMIN_ID
  ) {
    await ctx.answerCbQuery('⏳ Restarting...');
    process.exit();
  }
});

process.on('uncaughtException', (err) => {
  console.error('Unhandled Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

async function bootstrap() {
  if (USERBOT_LOGIN_ONLY) {
    await runUserbotLoginAndExit();
    process.exit(0);
  }

  bot.launch({ dropPendingUpdates: true });

  startMonitoringScheduler();

  void initUserbot().catch((error) => {
    console.error(
      'Userbot подключился с ошибкой (бот при этом уже слушает обновления):',
      error
    );
  });

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

void bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
