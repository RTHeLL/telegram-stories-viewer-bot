/**
 * Только первичная авторизация userbot — не подключает Telegraf.
 * См. docker-compose.login.yml → command / yarn userbot-login
 */

import { runUserbotLoginAndExit } from 'config/userbot';

void runUserbotLoginAndExit()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
