import { Userbot } from 'config/userbot';
import { timeout } from 'lib';
import { Api } from 'telegram';
import { FloodWaitError } from 'telegram/errors';

export interface PeerStoriesFetchOk {
  ok: true;
  activeStories: Api.TypeStoryItem[];
  pinnedStories: Api.TypeStoryItem[];
}

export interface PeerStoriesFetchErr {
  ok: false;
  error: string;
}

export async function fetchPeerStoriesAll(
  link: string
): Promise<PeerStoriesFetchOk | PeerStoriesFetchErr> {
  try {
    const client = await Userbot.getInstance();
    const entity = await client.getEntity(link);

    let activeStories: Api.TypeStoryItem[] = [];
    let pinnedStories: Api.TypeStoryItem[] = [];

    const active = await client.invoke(
      new Api.stories.GetPeerStories({ peer: entity })
    );
    await timeout(1000);

    const pinned = await client.invoke(
      new Api.stories.GetPinnedStories({ peer: entity })
    );
    await timeout(1000);

    if (active.stories.stories.length > 0) {
      activeStories = active.stories.stories;
    }
    if (pinned.stories.length > 0) {
      pinnedStories = pinned.stories.filter(
        (x) => !activeStories.some((y) => y.id === x.id)
      );
    }

    let last: number | null = pinnedStories.at(-1)?.id ?? null;

    while (last) {
      const oldestStories = await client
        .invoke(
          new Api.stories.GetPinnedStories({
            peer: link,
            offsetId: last,
          })
        )
        .catch(() => null);
      await timeout(1000);

      if (oldestStories && oldestStories.stories.length > 0) {
        pinnedStories.push(...oldestStories.stories);
      }

      if (oldestStories) {
        last = oldestStories.stories.at(-1)?.id ?? null;
      } else last = null;
    }

    return { ok: true, activeStories, pinnedStories };
  } catch (error) {
    if (error instanceof FloodWaitError) {
      return {
        ok: false,
        error:
          "⚠️ There're too much requests from the users, please wait " +
          (error.seconds / 60).toFixed(0) +
          ' minutes\n\n(You can use [scheduled message](https://telegram.org/blog/scheduled-reminders-themes) feature btw)',
      };
    }

    if (JSON.stringify(error).includes('FloodWaitError')) {
      return {
        ok: false,
        error:
          '⚠️ Too much requests accepted from users, please try again later',
      };
    }

    if (link.startsWith('+')) {
      return {
        ok: false,
        error:
          '⚠️ if user keeps phone number private, the bot cannot get access to stories',
      };
    }

    return { ok: false, error: '🚫 Wrong link to user!' };
  }
}
