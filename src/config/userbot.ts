import input from 'input';
import { TelegramClient } from 'telegram';
import { StoreSession } from 'telegram/sessions';

import {
  USERBOT_API_HASH,
  USERBOT_API_ID,
  USERBOT_PHONE_NUMBER,
} from './env-config';

export class Userbot {
  private static client: TelegramClient | undefined;
  /** Один общий промис входа MTProto — без этого два параллельных вызова открывают второй канал авторизации («код ещё раз»). */
  private static connecting: Promise<TelegramClient> | undefined;

  public static async getInstance(): Promise<TelegramClient> {
    if (Userbot.client) {
      return Userbot.client;
    }
    if (!Userbot.connecting) {
      Userbot.connecting = initClient()
        .then((client) => {
          Userbot.client = client;
          Userbot.connecting = undefined;
          return client;
        })
        .catch((error) => {
          Userbot.connecting = undefined;
          throw error;
        });
    }
    return Userbot.connecting;
  }
}

function canInteractiveLoginViaStdin(): boolean {
  return (
    typeof process.stdin.isTTY === 'boolean' &&
    process.stdin.isTTY &&
    typeof process.stdout.isTTY === 'boolean' &&
    process.stdout.isTTY
  );
}

/**
 * MTProto вход.
 * Без интерактива (docker up -d) — только уже сохранённая сессия, иначе зависание на input.text без TTY.
 * Интерактив вход — см. docker-compose.login.yml или runUserbotLoginAndExit(..., явно включённое).
 */
export async function createAndStartUserbotClient(options?: {
  allowInteractiveLogin?: boolean;
}): Promise<TelegramClient> {
  const allowInteractive = options?.allowInteractiveLogin ?? true;

  const storeSession = new StoreSession('userbot-session');

  const client = new TelegramClient(
    storeSession,
    USERBOT_API_ID,
    USERBOT_API_HASH,
    {
      connectionRetries: 5,
    }
  );

  if (!allowInteractive) {
    await client.connect();
    if (await client.checkAuthorization()) {
      return client;
    }
    throw new Error(
      'Userbot не авторизован или сессия не найдена в userbot-session. ' +
        'Выполните одноразовый вход: docker compose -f docker-compose.yml -f docker-compose.login.yml run --rm bot'
    );
  }

  await client.start({
    phoneNumber: USERBOT_PHONE_NUMBER,
    password: () => input.text('Please enter your password: '),
    phoneCode: () => input.text('Please enter the code you received: '),
    onError: (err) => console.log('error', err),
  });

  return client;
}

async function initClient() {
  const client = await createAndStartUserbotClient({
    allowInteractiveLogin: canInteractiveLoginViaStdin(),
  });
  console.log('You should now be connected.');
  await client.sendMessage('me', { message: 'Hi!' });
  return client;
}

/**
 * Один сеанс «только авторизация»: без Telegraf/Gram long poll.
 * Разрывает MTProto-соединение иначе Node не завершится и SIGINT может «не доходить».
 */
export async function runUserbotLoginAndExit(): Promise<void> {
  let client: TelegramClient | null = null;

  const gracefulStop = async (code: number) => {
    if (client?.connected) {
      await client.disconnect().catch(() => undefined);
    }
    process.exit(code);
  };

  process.once('SIGINT', () => void gracefulStop(130));
  process.once('SIGTERM', () => void gracefulStop(143));

  client = await createAndStartUserbotClient({ allowInteractiveLogin: true });

  try {
    console.log('You should now be connected.');
    await client.sendMessage('me', { message: 'Hi!' });
  } finally {
    if (client.connected) {
      await client.disconnect().catch(() => undefined);
    }
  }

  console.log(
    'Сессия userbot сохранена в томе userbot-session. Дальше: docker compose up -d'
  );
}

export async function initUserbot() {
  await Userbot.getInstance(); // init

  console.log('userbot initiated');
}
