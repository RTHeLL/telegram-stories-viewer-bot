import { Userbot } from 'config/userbot';
import { createEffect } from 'effector';
import { bot } from 'index';
import { fetchPeerStoriesAll } from 'lib/fetch-peer-stories';
import { tempMessageSent } from 'services/stories-events';
import type { UserInfo } from 'services/stories-service';
import { Api } from 'telegram';

import { notifyAdmin } from './send-message';

export const getAllStoriesFx = createEffect(async (task: UserInfo) => {
  try {
    const client = await Userbot.getInstance();
    const entity = await client.getEntity(task.link);

    bot.telegram
      .sendMessage(task.chatId, '⏳ Fetching stories...')
      .then(({ message_id }) => {
        tempMessageSent(message_id);
        notifyAdmin({ task, status: 'start' });
      })
      .catch(() => null);

    if (task.nextStoriesIds) {
      const paginatedStories = await client.invoke(
        new Api.stories.GetStoriesByID({
          peer: entity,
          id: task.nextStoriesIds,
        })
      );

      if (paginatedStories.stories.length > 0) {
        return {
          activeStories: [],
          pinnedStories: [],
          paginatedStories: paginatedStories.stories,
        };
      }

      return '🚫 Stories not found!';
    }

    const fetched = await fetchPeerStoriesAll(task.link);
    if (!fetched.ok) {
      return fetched.error;
    }

    const { activeStories, pinnedStories } = fetched;

    if (activeStories.length > 0 || pinnedStories.length > 0) {
      const text =
        `⚡️ ${activeStories.length} Active stories found and\n` +
        `📌 ${pinnedStories.length} Pinned ones!`;
      bot.telegram
        .sendMessage(task.chatId, text)
        .then(({ message_id }) => {
          tempMessageSent(message_id);
          notifyAdmin({
            task,
            status: 'info',
            baseInfo: text,
          });
        })
        .catch(() => null);
      return { activeStories, pinnedStories };
    }

    return '🚫 Stories not found!';
  } catch (error) {
    console.log('getAllStoriesFx error:', error);
    if (task.link.startsWith('+')) {
      return '⚠️ if user keeps phone number private, the bot cannot get access to stories';
    }

    return '🚫 Wrong link to user!';
  }
});

export const getParticularStoryFx = createEffect(async (task: UserInfo) => {
  try {
    const client = await Userbot.getInstance();
    const linkPaths = task.link.split('/');
    const storyId = Number(linkPaths.at(-1));
    const username = linkPaths.at(-3);

    const entity = await client.getEntity(username!);

    const storyData = await client.invoke(
      new Api.stories.GetStoriesByID({ id: [storyId], peer: entity })
    );

    if (storyData.stories.length === 0) throw new Error('stories not found!');

    const text = '⚡️ Story founded successfully!';
    bot.telegram
      .sendMessage(task.chatId!, text)
      .then(({ message_id }) => {
        tempMessageSent(message_id);
        notifyAdmin({ task, status: 'start' });
      })
      .catch(() => null);

    return {
      activeStories: [],
      pinnedStories: [],
      particularStory: storyData.stories[0],
    };
  } catch (error) {
    console.log('ERROR occured:', error);
    return '🚫 Something wrong with the link!';
  }
});
