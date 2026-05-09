import { Context, Scenes } from 'telegraf';
import { User } from 'telegraf/typings/core/types/typegram';

export interface UserSession extends User {
  messagesToRemove: number[];
}

interface SceneSession extends Scenes.SceneSession {
  usersList: UserSession[] | undefined;
  /** Ожидаем @username / +телефон после «Добавить» в мониторинге */
  awaitingMonitorTargetLink?: boolean;
}

export interface IContextBot extends Context {
  scene: Scenes.SceneContextScene<IContextBot>;
  session: SceneSession;
}
