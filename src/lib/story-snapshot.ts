import type { StorySnapshotMeta } from 'storage/monitoring-persistence';
import { Api } from 'telegram';

export function storyMetaFromApiItems(
  stories: Api.TypeStoryItem[],
  kind: 'active' | 'pinned'
): StorySnapshotMeta[] {
  const out: StorySnapshotMeta[] = [];

  for (const x of stories) {
    let mediaType: StorySnapshotMeta['mediaType'] = 'unknown';
    if ('media' in x) {
      mediaType = 'photo' in x.media ? 'photo' : 'video';
    }
    out.push({
      id: x.id,
      dateUnix: 'date' in x ? Number(x.date) : 0,
      mediaType,
      caption: 'caption' in x ? x.caption : undefined,
      kind,
    });
  }

  return out;
}

export function snapshotPayloadFromPeerStories(
  activeStories: Api.TypeStoryItem[],
  pinnedStories: Api.TypeStoryItem[]
): { stories: StorySnapshotMeta[] } {
  return {
    stories: [
      ...storyMetaFromApiItems(activeStories, 'active'),
      ...storyMetaFromApiItems(pinnedStories, 'pinned'),
    ],
  };
}

export function idsSignatureFromPayload(stories: StorySnapshotMeta[]): string {
  return [...stories.map((s) => s.id)].sort((a, b) => a - b).join(',');
}
