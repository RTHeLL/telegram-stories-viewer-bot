/**
 * Только первичная авторизация userbot — не подключает Telegraf.
 * См. docker-compose.login.yml → command / yarn userbot-login
 */

import { runUserbotLoginAndExit } from 'config/userbot';

void runUserbotLoginAndExit()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
