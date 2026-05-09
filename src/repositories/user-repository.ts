import { notifyAdmin } from 'controllers/send-message';
import { insertUserIfAbsent } from 'storage/user-persistence';
import { User } from 'telegraf/typings/core/types/typegram';

export const saveUser = async (user: User) => {
  try {
    const inserted = await insertUserIfAbsent(user);
    if (inserted) {
      notifyAdmin({
        status: 'info',
        baseInfo: `👤 New user added to DB`,
      });
    }
  } catch (error) {
    notifyAdmin({
      status: 'error',
      baseInfo: `❌ error occured adding user to DB:\n${JSON.stringify(error)}`,
    });
    console.log('error on saving user:', error);
  }
};
