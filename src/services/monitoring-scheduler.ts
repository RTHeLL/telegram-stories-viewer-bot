import { MONITOR_INTERVAL_MS } from 'config/env-config';
import { sendStoriesFx } from 'controllers/send-stories';
import { bot } from 'index';
import { timeout } from 'lib';
import { fetchPeerStoriesAll } from 'lib/fetch-peer-stories';
import {
  idsSignatureFromPayload,
  snapshotPayloadFromPeerStories,
} from 'lib/story-snapshot';
import type { UserInfo } from 'services/stories-service';
import {
  getLastHistoryForTarget,
  insertStoryHistory,
  listAllEnabledMonitoredTargets,
  type StoryHistoryPayload,
} from 'storage/monitoring-persistence';

let schedulerStarted = false;
let tickRunning = false;

async function processOneTarget(input: {
  owner_chat_id: string;
  target_link: string;
  monitored_target_id: number;
}): Promise<void> {
  const { owner_chat_id, target_link, monitored_target_id } = input;

  const fetched = await fetchPeerStoriesAll(target_link);
  if (!fetched.ok) {
    await bot.telegram
      .sendMessage(
        owner_chat_id,
        `⚠️ Мониторинг ${target_link}: ${fetched.error}`,
        {
          link_preview_options: { is_disabled: true },
        }
      )
      .catch(() => null);
    return;
  }

  const { activeStories, pinnedStories } = fetched;
  const payload = snapshotPayloadFromPeerStories(activeStories, pinnedStories);
  const signature = idsSignatureFromPayload(payload.stories);

  const prev = await getLastHistoryForTarget(owner_chat_id, target_link);

  if (prev === null) {
    await insertStoryHistory({
      owner_chat_id,
      target_link,
      monitored_target_id,
      source: 'monitor',
      payload,
    });

    const n = payload.stories.length;
    await bot.telegram
      .sendMessage(
        owner_chat_id,
        n > 0
          ? `📌 Мониторинг: базовая синхронизация для ${target_link}.\nСохранены текущие ${n} историй; дальше будут приходить только новые.`
          : `📌 Мониторинг: базовая синхронизация для ${target_link}.\nСейчас нет доступных историй; при появлении новых бот пришлёт их.`,
        { link_preview_options: { is_disabled: true } }
      )
      .catch(() => null);
    return;
  }

  let prevSignature = '';
  try {
    const parsed = JSON.parse(prev.payload_json) as StoryHistoryPayload;
    prevSignature = idsSignatureFromPayload(parsed.stories ?? []);
  } catch {
    prevSignature = '';
  }

  if (signature === prevSignature) {
    return;
  }

  const prevIds = new Set<number>();
  try {
    const parsed = JSON.parse(prev.payload_json) as StoryHistoryPayload;
    for (const s of parsed.stories ?? []) {
      prevIds.add(s.id);
    }
  } catch {
    /* ignore */
  }

  const newActive = activeStories.filter((s) => !prevIds.has(s.id));
  const newPinned = pinnedStories.filter((s) => !prevIds.has(s.id));

  if (newActive.length > 0 || newPinned.length > 0) {
    const task: UserInfo = {
      chatId: owner_chat_id,
      link: target_link,
      linkType: 'username',
      locale: '',
      initTime: Date.now(),
      skipAdminNotify: true,
      persistHistory: false,
    };

    await bot.telegram
      .sendMessage(
        owner_chat_id,
        `🔔 Новые истории: ${target_link}\n⚡ active: ${newActive.length}, 📌 pinned: ${newPinned.length}`,
        { link_preview_options: { is_disabled: true } }
      )
      .catch(() => null);

    await sendStoriesFx({
      activeStories: newActive,
      pinnedStories: newPinned,
      task,
    });
  }

  await insertStoryHistory({
    owner_chat_id,
    target_link,
    monitored_target_id,
    source: 'monitor',
    payload,
  });
}

async function runMonitoringTick(): Promise<void> {
  if (tickRunning) return;
  tickRunning = true;
  try {
    const targets = await listAllEnabledMonitoredTargets();

    for (const t of targets) {
      await processOneTarget({
        owner_chat_id: t.owner_chat_id,
        target_link: t.target_link,
        monitored_target_id: t.id,
      });
      await timeout(2500);
    }
  } catch (error) {
    console.error('monitoring tick:', error);
  } finally {
    tickRunning = false;
  }
}

export function startMonitoringScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  void runMonitoringTick();

  setInterval(() => {
    void runMonitoringTick();
  }, MONITOR_INTERVAL_MS);

  console.log(
    `Monitoring scheduler: interval ${MONITOR_INTERVAL_MS} ms (${(MONITOR_INTERVAL_MS / 3600000).toFixed(2)} h)`
  );
}
