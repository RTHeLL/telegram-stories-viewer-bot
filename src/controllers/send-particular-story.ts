import { bot } from 'index';
import {
  cleanUpTempMessagesFired,
  tempMessageSent,
} from 'services/stories-events';
import { Api } from 'telegram';

import { downloadStories, mapStories } from './download-stories';
import { notifyAdmin } from './send-message';
import { SendStoriesArgs } from './types';

export async function sendParticularStory({
  story,
  task,
}: Omit<SendStoriesArgs, 'stories'> & {
  story: Api.TypeStoryItem;
}) {
  const mapped = mapStories([story]);

  try {
    bot.telegram
      .sendMessage(task.chatId, '⏳ Downloading...')
      .then(({ message_id }) => tempMessageSent(message_id))
      .catch(() => null);

    await downloadStories(mapped, 'active');

    const story = mapped[0];

    if (story.buffer) {
      bot.telegram
        .sendMessage(task.chatId, '⏳ Uploading to Telegram...')
        .then(({ message_id }) => tempMessageSent(message_id))
        .catch(() => null);

      await bot.telegram.sendMediaGroup(task.chatId, [
        {
          media: { source: story.buffer },
          type: story.mediaType,
          caption:
            `${story.caption ? `${story.caption}\n` : ''}` +
            `\n📅 Post date: ${story.date.toUTCString()}`,
        },
      ]);
    }
    notifyAdmin({
      status: 'info',
      baseInfo: `📥 Particular story uploaded to user!`,
    });
  } catch (error) {
    notifyAdmin({
      status: 'error',
      task,
      errorInfo: { cause: error },
    });
    console.log('error occured on sending PARTICULAR story:', error);
  }
  cleanUpTempMessagesFired();
}
