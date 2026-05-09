import { createEvent } from 'effector';

/** В отдельном файле без импортов send-*, чтобы не было цикла stories-service ↔ send-stories при старте. */
export const tempMessageSent = createEvent<number>();
export const cleanUpTempMessagesFired = createEvent();
