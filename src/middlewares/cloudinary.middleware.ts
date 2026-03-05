/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { memoryStorage } from 'multer';

export const cloudinaryMulterOptions = {
  storage: memoryStorage(),
};
