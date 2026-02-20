/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import * as dotenv from 'dotenv';
dotenv.config();
import { CronJob } from 'cron';
import axios from 'axios';

export const keepServerAliveDeployment = new CronJob(
  '*/10 * * * *',
  async function () {
    try {
      const serverUrl =
        process.env.BACKEND_URL ||
        `http://localhost:${process.env.PORT || 5000}`;

      const response = await axios.get(`${serverUrl}/api/v1/test`);

      console.log(
        `Keep-alive cron job executed successfully. Status: ${response.status}`,
        response.status,
      );
    } catch (error) {
      console.error(
        error instanceof Error ? error.message : String(error),
        500,
        JSON.stringify({
          timestamp: new Date().toISOString(),
        }),
      );
    }
  },
  null,
  true,
  'Africa/Lagos',
);

keepServerAliveDeployment.start();
