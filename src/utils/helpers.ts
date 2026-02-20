/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */

const DEFAULT_LIMIT = 10;
export default class Helper {
  static composePagination({
    count,
    page,
    limit,
  }: {
    count: number;
    page: number;
    limit: number | null;
  }) {
    return {
      count,
      totalPages: limit
        ? Math.ceil(count / limit)
        : Math.ceil(count / +DEFAULT_LIMIT),
      currentPage: +page || 1,
      limit: limit ? limit : DEFAULT_LIMIT,
    };
  }

  static generateUniqueCharacters(length = 6) {
    const chars = '0123456789';
    let result = '';

    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return result;
  }

  static set24HourExpiry() {
    return new Date(Date.now() + 1000 * 60 * 60 * 24);
  }
}
