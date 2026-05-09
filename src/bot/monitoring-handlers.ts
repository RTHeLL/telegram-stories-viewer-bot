import { IContextBot } from 'config/context-interface';
import { MONITOR_INTERVAL_MS } from 'config/env-config';
import { Userbot } from 'config/userbot';
import { sendStoriesFx } from 'controllers/send-stories';
import { fetchPeerStoriesAll } from 'lib/fetch-peer-stories';
import type { UserInfo } from 'services/stories-service';
import {
  addMonitoredTarget,
  getMonitoredTargetForOwner,
  getStoryHistoryByIdForOwner,
  initMonitoringSchema,
  listMonitoredTargetsForOwner,
  listStoryHistoryPage,
  removeMonitoredTarget,
  setMonitoredTargetEnabled,
  type StoryHistoryPayload,
} from 'storage/monitoring-persistence';
import { Markup, Telegraf } from 'telegraf';
import { Api } from 'telegram';

const PAGE = 8;

function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('📋 Список подписок', 'mon:list'),
      Markup.button.callback('➕ Добавить', 'mon:add'),
    ],
    [
      Markup.button.callback('🗂 История по цели', 'mon:pick_hist'),
      Markup.button.callback('ℹ️ Интервал', 'mon:interval_info'),
    ],
  ]);
}

async function sendMainMenu(ctx: IContextBot, text?: string) {
  const body =
    text ??
    'Настройки мониторинга.\n\nВыберите действие.\nДобавленные @username / +телефон проверяются в фоне; новые истории приходят в этот чат.';

  if (ctx.callbackQuery) {
    await ctx.editMessageText(body, {
      ...mainMenuKeyboard(),
      link_preview_options: { is_disabled: true },
    });
    await ctx.answerCbQuery().catch(() => null);
    return;
  }

  await ctx.reply(body, {
    ...mainMenuKeyboard(),
    link_preview_options: { is_disabled: true },
  });
}

function targetRowKeyboard(
  rows: { id: number; target_link: string; enabled: number }[]
) {
  const keyboard = rows.map((r) => [
    Markup.button.callback(
      `${r.enabled ? '✅' : '⏸'} ${r.target_link} (id ${r.id})`,
      `mon:togg:${r.id}`
    ),
    Markup.button.callback('🗑', `mon:rm:${r.id}`),
  ]);

  keyboard.push([Markup.button.callback('⬅️ В меню', 'mon:menu')]);
  return Markup.inlineKeyboard(keyboard);
}

export function registerMonitoringHandlers(app: Telegraf<IContextBot>): void {
  initMonitoringSchema();

  app.use((ctx, next) => {
    const c = ctx as IContextBot;
    if (!c.session) {
      c.session = {} as IContextBot['session'];
    }
    return next();
  });

  app.command(['monitor', 'settings', 'mon'], async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.reply('Мониторинг доступен только в личном чате.');
      return;
    }
    await sendMainMenu(ctx);
  });

  app.action(/^mon:menu$/u, async (ctx) => {
    ctx.session.awaitingMonitorTargetLink = false;
    await sendMainMenu(ctx);
  });

  app.action(/^mon:list$/u, async (ctx) => {
    if (!ctx.from) return await ctx.answerCbQuery().catch(() => null);
    const list = await listMonitoredTargetsForOwner(String(ctx.from.id));

    if (list.length === 0) {
      await ctx
        .editMessageText(
          'Подписок пока нет. Нажмите «Добавить», затем отправьте @username или +телефон.',
          {
            ...Markup.inlineKeyboard([
              [Markup.button.callback('➕ Добавить', 'mon:add')],
              [Markup.button.callback('⬅️ В меню', 'mon:menu')],
            ]),
            link_preview_options: { is_disabled: true },
          }
        )
        .catch(() => null);
      await ctx.answerCbQuery().catch(() => null);
      return;
    }

    await ctx
      .editMessageText(
        'Ваши подписки. Нажмите строку чтобы выкл./вкл., 🗑 — удалить:',
        {
          ...targetRowKeyboard(list),
          link_preview_options: { is_disabled: true },
        }
      )
      .catch(() => null);
    await ctx.answerCbQuery().catch(() => null);
  });

  app.action(/^mon:add$/u, async (ctx) => {
    if (!ctx.from) return await ctx.answerCbQuery().catch(() => null);
    ctx.session.awaitingMonitorTargetLink = true;

    await ctx
      .editMessageText(
        'Отправьте в этот чат @username или +телефон для мониторинга.\nОтмена: /monitor.',
        {
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ В меню', 'mon:menu')],
          ]),
          link_preview_options: { is_disabled: true },
        }
      )
      .catch(() => null);
    await ctx.answerCbQuery().catch(() => null);
  });

  app.action(/^mon:interval_info$/u, async (ctx) => {
    const ms = MONITOR_INTERVAL_MS;
    const hours = (ms / 3_600_000).toFixed(2);
    await ctx
      .editMessageText(
        `Интервал фоновых проверок задаётся переменной окружения MONITOR_INTERVAL_MS (миллисекунды).\nПо умолчанию: 3600000 (1 час).\nТекущее значение в процессе: ~${hours} ч.`,
        {
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ В меню', 'mon:menu')],
          ]),
          link_preview_options: { is_disabled: true },
        }
      )
      .catch(() => null);
    await ctx.answerCbQuery().catch(() => null);
  });

  app.action(/^mon:pick_hist$/u, async (ctx) => {
    if (!ctx.from) return await ctx.answerCbQuery().catch(() => null);
    const list = await listMonitoredTargetsForOwner(String(ctx.from.id));

    if (list.length === 0) {
      await ctx
        .editMessageText(
          'Нет подписок — нечего показывать в истории. Сначала добавьте цель.',
          {
            ...Markup.inlineKeyboard([
              [Markup.button.callback('➕ Добавить', 'mon:add')],
              [Markup.button.callback('⬅️ В меню', 'mon:menu')],
            ]),
            link_preview_options: { is_disabled: true },
          }
        )
        .catch(() => null);
      await ctx.answerCbQuery().catch(() => null);
      return;
    }

    const rows = list.map((t) => [
      Markup.button.callback(`🗂 ${t.target_link}`, `mon:hist:${t.id}:0`),
    ]);
    rows.push([Markup.button.callback('⬅️ В меню', 'mon:menu')]);

    await ctx
      .editMessageText('Выберите цель, чтобы открыть историю снимков:', {
        ...Markup.inlineKeyboard(rows),
        link_preview_options: { is_disabled: true },
      })
      .catch(() => null);
    await ctx.answerCbQuery().catch(() => null);
  });

  app.action(/^mon:hist:(\d+):(\d+)$/u, async (ctx) => {
    if (!ctx.from) return await ctx.answerCbQuery().catch(() => null);

    const id = Number(ctx.match[1]);
    const page = Number(ctx.match[2]);

    const target = await getMonitoredTargetForOwner(String(ctx.from.id), id);
    if (!target) {
      await ctx.answerCbQuery('Подписка не найдена').catch(() => null);
      return;
    }

    const history = await listStoryHistoryPage({
      owner_chat_id: String(ctx.from.id),
      target_link: target.target_link,
      limit: PAGE,
      offset: page * PAGE,
    });

    if (history.length === 0) {
      await ctx
        .editMessageText(
          `История для ${target.target_link} пуста. Снимки появятся после ручных запросов или фонового мониторинга.`,
          {
            ...Markup.inlineKeyboard([
              [Markup.button.callback('⬅️ К целям', 'mon:pick_hist')],
              [Markup.button.callback('🏠 В меню', 'mon:menu')],
            ]),
            link_preview_options: { is_disabled: true },
          }
        )
        .catch(() => null);
      await ctx.answerCbQuery().catch(() => null);
      return;
    }

    let text =
      `История (${target.target_link}), страница ${page + 1}\n\n` +
      history
        .map((h, i) => {
          let cnt = '?';
          try {
            const p = JSON.parse(h.payload_json) as StoryHistoryPayload;
            cnt = String(p.stories?.length ?? 0);
          } catch {
            cnt = '?';
          }
          return `${page * PAGE + i + 1}. #${h.id} · ${h.source} · ${h.fetched_at} · ${cnt} шт.`;
        })
        .join('\n');

    text += `\n\nНажмите «Получить медиа» у записи ниже — бот заново загрузит истории из Telegram по сохранённым id (если они ещё доступны у источника).`;

    const rowButtons = history.map((h) => [
      Markup.button.callback(`📥 Медиа #${h.id}`, `mon:redl:${h.id}`),
    ]);

    const nav: ReturnType<typeof Markup.button.callback>[][] = [];
    if (page > 0) {
      nav.push([
        Markup.button.callback('⬅️ Пред.', `mon:hist:${id}:${page - 1}`),
      ]);
    }
    if (history.length === PAGE) {
      nav.push([
        Markup.button.callback('След. ➡️', `mon:hist:${id}:${page + 1}`),
      ]);
    }

    rowButtons.push(...nav);
    rowButtons.push([
      Markup.button.callback('⬅️ К целям', 'mon:pick_hist'),
      Markup.button.callback('🏠 В меню', 'mon:menu'),
    ]);

    await ctx
      .editMessageText(text, {
        ...Markup.inlineKeyboard(rowButtons),
        link_preview_options: { is_disabled: true },
      })
      .catch(() => null);
    await ctx.answerCbQuery().catch(() => null);
  });

  app.action(/^mon:redl:(\d+)$/u, async (ctx) => {
    if (!ctx.from) return await ctx.answerCbQuery().catch(() => null);
    const hid = Number(ctx.match[1]);

    const row = await getStoryHistoryByIdForOwner(String(ctx.from.id), hid);
    if (!row) {
      await ctx.answerCbQuery('Запись не найдена').catch(() => null);
      return;
    }

    await ctx.answerCbQuery('⏳ Загрузка...').catch(() => null);

    let payload: StoryHistoryPayload;
    try {
      payload = JSON.parse(row.payload_json) as StoryHistoryPayload;
    } catch {
      await ctx.reply('Не удалось прочитать сохранённые данные записи.', {
        link_preview_options: { is_disabled: true },
      });
      return;
    }

    const ids = [...new Set((payload.stories ?? []).map((s) => s.id))];

    if (ids.length === 0) {
      await ctx.reply('В записи не было сохранено ни одной истории.', {
        link_preview_options: { is_disabled: true },
      });
      return;
    }

    const fresh = await fetchPeerStoriesAll(row.target_link);

    if (!fresh.ok) {
      await ctx.reply(`Не удалось получить истории: ${fresh.error}`, {
        link_preview_options: { is_disabled: true },
      });
      return;
    }

    const idSet = new Set(ids);
    const active = fresh.activeStories.filter((s) => idSet.has(s.id));
    const pinned = fresh.pinnedStories.filter((s) => idSet.has(s.id));
    let foundCount = active.length + pinned.length;

    if (foundCount === 0 && ids.length > 0) {
      try {
        const client = await Userbot.getInstance();
        const entity = await client.getEntity(row.target_link);
        const byId = await client.invoke(
          new Api.stories.GetStoriesByID({ peer: entity, id: ids })
        );
        const fallback = [...byId.stories];
        await sendStoriesFx({
          activeStories: fallback.length > 0 ? fallback : [],
          pinnedStories: [],
          task: {
            chatId: String(ctx.from!.id),
            link: row.target_link,
            linkType: 'username',
            locale: '',
            initTime: Date.now(),
            skipAdminNotify: true,
            persistHistory: false,
          },
        });

        await ctx.reply('Готово: отправлены материалы по сохранённым id.', {
          link_preview_options: { is_disabled: true },
        });
        return;
      } catch (error) {
        console.error('mon:redl GetStoriesByID:', error);
        foundCount = 0;
      }
    }

    if (foundCount === 0 && ids.length > 0) {
      await ctx.reply(
        'Telegram уже не отдаёт эти истории (срок истёк или они удалены).',
        { link_preview_options: { is_disabled: true } }
      );
      return;
    }

    const task: UserInfo = {
      chatId: String(ctx.from!.id),
      link: row.target_link,
      linkType: 'username',
      locale: '',
      initTime: Date.now(),
      skipAdminNotify: true,
      persistHistory: false,
    };

    await sendStoriesFx({
      activeStories: active,
      pinnedStories: pinned,
      task,
    });

    await ctx.reply('Запись из истории отправлена в чат выше.', {
      link_preview_options: { is_disabled: true },
    });
  });

  app.action(/^mon:togg:(\d+)$/u, async (ctx) => {
    if (!ctx.from) return await ctx.answerCbQuery().catch(() => null);
    const id = Number(ctx.match[1]);

    const t = await getMonitoredTargetForOwner(String(ctx.from.id), id);
    if (!t) {
      await ctx.answerCbQuery('Не найдено').catch(() => null);
      return;
    }

    const nextEnabled = t.enabled !== 1;
    await setMonitoredTargetEnabled(String(ctx.from.id), id, nextEnabled);

    await ctx
      .answerCbQuery(nextEnabled ? 'Включено' : 'Выключено')
      .catch(() => null);

    const list = await listMonitoredTargetsForOwner(String(ctx.from.id));

    await ctx
      .editMessageText(
        'Ваши подписки. Нажмите строку чтобы выкл./вкл., 🗑 — удалить:',
        {
          ...targetRowKeyboard(list),
          link_preview_options: { is_disabled: true },
        }
      )
      .catch(() => null);
  });

  app.action(/^mon:rm:(\d+)$/u, async (ctx) => {
    if (!ctx.from) return await ctx.answerCbQuery().catch(() => null);
    const id = Number(ctx.match[1]);

    const ok = await removeMonitoredTarget(String(ctx.from.id), id);

    await ctx.answerCbQuery(ok ? 'Удалено' : 'Не найдено').catch(() => null);

    const list = await listMonitoredTargetsForOwner(String(ctx.from.id));

    if (list.length === 0) {
      await ctx
        .editMessageText('Подписок больше нет. Используйте «Добавить».', {
          ...Markup.inlineKeyboard([
            [Markup.button.callback('➕ Добавить', 'mon:add')],
            [Markup.button.callback('⬅️ В меню', 'mon:menu')],
          ]),
          link_preview_options: { is_disabled: true },
        })
        .catch(() => null);
      return;
    }

    await ctx
      .editMessageText(
        'Ваши подписки. Нажмите строку чтобы выкл./вкл., 🗑 — удалить:',
        {
          ...targetRowKeyboard(list),
          link_preview_options: { is_disabled: true },
        }
      )
      .catch(() => null);
  });
}

export async function tryHandleMonitorLinkInput(
  ctx: IContextBot,
  text: string
): Promise<boolean> {
  if (!ctx.from || ctx.chat?.type !== 'private') return false;
  if (!ctx.session) return false;

  const pending = Boolean(ctx.session.awaitingMonitorTargetLink);
  if (!pending) return false;

  const trimmed = text.trim();
  const isLink =
    trimmed.startsWith('@') ||
    (trimmed.startsWith('+') && trimmed.length >= 11);

  if (!isLink) {
    await ctx.reply(
      'Нужно отправить @username или +телефон как в основном режиме бота. Или вернитесь в меню: /monitor'
    );
    return true;
  }

  ctx.session.awaitingMonitorTargetLink = false;

  const res = await addMonitoredTarget(String(ctx.from.id), trimmed);

  if ('error' in res) {
    await ctx.reply(res.error, {
      link_preview_options: { is_disabled: true },
    });
    return true;
  }

  await ctx.reply(
    `Подписка создана (${trimmed}), id записи ${res.id}. Первая фоновая синхронизация создаёт «базу» историй без рассылки — дальше придут только новые.`,
    {
      ...mainMenuKeyboard(),
      link_preview_options: { is_disabled: true },
    }
  );

  return true;
}
